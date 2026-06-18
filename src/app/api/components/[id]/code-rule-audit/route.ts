// POST /api/components/[id]/code-rule-audit
//
// Reads the component's mapped source files (source.paths) from the
// connected read-only source repo and asks the code-rule-auditor agent to
// populate each rule's `implemented` facet from the actual code, judge how
// it relates to the documented rule, and surface undocumented rules.
// Returns advisory proposals only — nothing is written; the analyst
// approves them in the dialog, which saves through the normal component PUT.

import { NextResponse } from "next/server"
import { getComponent } from "@/lib/github"
import { isValidName } from "@/lib/validate"
import { isLLMConfigured, LLM_DISABLED_MESSAGE, getLLM } from "@/lib/llm"
import { checkRateLimit } from "@/lib/rate-limit"
import { getAgent, agentInstruction } from "@/lib/agents"
import {
  isRuleAuditAvailable,
  readComponentSource,
  buildRuleAuditPrompt,
  parseRuleAuditProposals,
} from "@/lib/code-rule-audit"
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
      if (!isRuleAuditAvailable(component)) {
        return NextResponse.json(
          {
            error:
              "Source code is not connected, or this component has no mapped source files (source.paths).",
          },
          { status: 400 }
        )
      }

      const files = await readComponentSource(component)
      if (files.length === 0) {
        return NextResponse.json({ proposals: [], files: [], note: "No readable source files." })
      }

      const agent = await getAgent("code-rule-auditor")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const llm: any = await getLLM()
      const raw: string = await llm.complete({
        prompt: buildRuleAuditPrompt(agentInstruction(agent), component, files),
        maxTokens: 4000,
      })

      const capturedAt = new Date().toISOString()
      const proposals = parseRuleAuditProposals(raw, component, files, capturedAt)
      getLogger().info("Code rule audit complete", {
        id,
        files: files.length,
        proposed: proposals.length,
      })
      return NextResponse.json({ proposals, files: files.map((f) => f.path) })
    } catch (error) {
      getLogger().error("Code rule audit failed", {
        id,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json(
        { error: `Audit failed: ${error instanceof Error ? error.message : "Unknown error"}` },
        { status: 500 }
      )
    }
  })
}
