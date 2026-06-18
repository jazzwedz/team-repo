// POST /api/admin/consistency-check/ai
//
// AI relationship audit. Complements the deterministic consistency
// check: it looks for links that SHOULD exist but neither component
// declares. Deterministic candidate generation (no LLM) produces a
// bounded, ranked set of suspicious pairs; the relationship-auditor
// agent then judges each one. Returns advisory ConsistencyIssues only —
// nothing is written. The analyst applies each via the apply endpoint
// (which takes the AI fix inline).

import { NextResponse } from "next/server"
import { listComponents } from "@/lib/github"
import { listSolutions } from "@/lib/solutions"
import { isLLMConfigured, LLM_DISABLED_MESSAGE, getLLM } from "@/lib/llm"
import { checkRateLimit } from "@/lib/rate-limit"
import { getAgent, agentInstruction } from "@/lib/agents"
import {
  generateCandidates,
  buildAuditPrompt,
  parseAuditVerdicts,
} from "@/lib/relationship-audit"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function POST(request: Request) {
  return withRouteContext(request, async () => {
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
      const components = await listComponents()
      const solutions = await listSolutions().catch(() => [])
      const byId = new Map(components.map((c) => [c.id, c]))

      const candidates = generateCandidates(components, solutions)
      if (candidates.length === 0) {
        return NextResponse.json({ components: components.length, candidates: 0, issues: [] })
      }

      const agent = await getAgent("relationship-auditor")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const llm: any = await getLLM()
      const raw: string = await llm.complete({
        prompt: buildAuditPrompt(agentInstruction(agent), candidates, byId),
        maxTokens: 4000,
      })

      const issues = parseAuditVerdicts(raw, candidates, byId)
      getLogger().info("Relationship audit complete", {
        components: components.length,
        candidates: candidates.length,
        proposed: issues.length,
      })
      return NextResponse.json({ components: components.length, candidates: candidates.length, issues })
    } catch (error) {
      getLogger().error("Relationship audit failed", {
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json(
        { error: `Audit failed: ${error instanceof Error ? error.message : "Unknown error"}` },
        { status: 500 }
      )
    }
  })
}
