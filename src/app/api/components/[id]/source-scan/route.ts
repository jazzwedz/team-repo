// POST /api/components/[id]/source-scan
//
// Source mapper — scans the connected read-only source repo and proposes
// which files implement this component (its source.paths), so a business
// analyst never has to know the code layout. Returns advisory proposals
// only; the analyst approves them in the dialog, which writes source.paths
// through the normal sha-guarded component save. Standalone from the rule
// audit — it only fills source.paths.

import { NextResponse } from "next/server"
import { getComponent } from "@/lib/github"
import { isValidName } from "@/lib/validate"
import { isLLMConfigured, LLM_DISABLED_MESSAGE, getLLM } from "@/lib/llm"
import { checkRateLimit } from "@/lib/rate-limit"
import { getAgent, agentInstruction } from "@/lib/agents"
import {
  isSourceMapAvailable,
  gatherCandidates,
  readCandidateHeads,
  buildMapperPrompt,
  parseSourceMapProposals,
} from "@/lib/source-mapper"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRouteContext(request, async () => {
    const { id } = await params
    if (!isValidName(id)) {
      return NextResponse.json({ error: "Invalid component id" }, { status: 400 })
    }
    if (!isSourceMapAvailable()) {
      return NextResponse.json(
        { error: "Source code is not connected. Configure SRC_ADO_* under Settings → Health checks." },
        { status: 400 }
      )
    }
    if (!isLLMConfigured()) {
      return NextResponse.json({ error: LLM_DISABLED_MESSAGE }, { status: 503 })
    }
    const clientIp = request.headers.get("x-forwarded-for") || "unknown"
    if (!checkRateLimit(clientIp)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a minute before trying again." },
        { status: 429 }
      )
    }

    try {
      const { sha: _sha, ...component } = await getComponent(id)
      const { candidates, indexed, contentSource } = await gatherCandidates(component)
      if (candidates.length === 0) {
        return NextResponse.json({
          proposals: [],
          indexed,
          contentSource,
          note: "No files matched this component by name or content in the repo. Map a path by hand if you know it.",
        })
      }

      const heads = await readCandidateHeads(candidates)
      const agent = await getAgent("source-mapper")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const llm: any = await getLLM()
      const raw: string = await llm.complete({
        prompt: buildMapperPrompt(agentInstruction(agent), component, candidates, heads),
        maxTokens: 2000,
      })

      const proposals = parseSourceMapProposals(raw, candidates)
      getLogger().info("Source scan complete", {
        id,
        indexed,
        candidates: candidates.length,
        contentSource,
        proposed: proposals.length,
      })
      return NextResponse.json({ proposals, indexed, candidates: candidates.length, contentSource })
    } catch (error) {
      getLogger().error("Source scan failed", {
        id,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json(
        { error: `Scan failed: ${error instanceof Error ? error.message : "Unknown error"}` },
        { status: 500 }
      )
    }
  })
}
