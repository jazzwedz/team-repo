import { NextResponse } from "next/server"
import { checkRateLimit } from "@/lib/rate-limit"
import type { BlastRadiusResult, ImpactedComponent } from "@/lib/blast-radius"
import { LINK_ROLE_LABELS } from "@/lib/constants"
import {
  getLLM,
  isLLMConfigured,
  LLM_DISABLED_MESSAGE,
} from "@/lib/llm"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export async function POST(request: Request) {
  return withRouteContext(request, () => doPost(request))
}

async function doPost(request: Request) {
  try {
    if (!isLLMConfigured()) {
      return NextResponse.json({ error: LLM_DISABLED_MESSAGE }, { status: 503 })
    }
    const llm = await getLLM()
    const clientIp = request.headers.get("x-forwarded-for") || "unknown"
    if (!checkRateLimit(clientIp)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a minute before trying again." },
        { status: 429 }
      )
    }

    const blastData = (await request.json()) as BlastRadiusResult
    if (!blastData?.source?.id || !Array.isArray(blastData.layers)) {
      return NextResponse.json({ error: "Invalid blast radius payload" }, { status: 400 })
    }

    const prompt = buildMemoPrompt(blastData)
    const memo = await llm.complete({ prompt, maxTokens: 2048 })

    return NextResponse.json({ memo })
  } catch (error) {
    getLogger().error("Failed to generate impact memo", {
      err: error instanceof Error ? error.message : "Unknown error",
    })
    return NextResponse.json(
      { error: "Failed to generate impact memo" },
      { status: 500 }
    )
  }
}

function summarizeImpacted(comps: ImpactedComponent[]): string {
  if (comps.length === 0) return "  (none)"
  return comps
    .map((c) => {
      const flags: string[] = []
      if (c.status === "production") flags.push("PRODUCTION")
      if (c.nfrGap) flags.push("no RTO")
      if (c.hasConfidentialData) flags.push("confidential data")
      const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : ""
      const via = LINK_ROLE_LABELS[c.via.role] || c.via.role
      const through = c.via.fromComponent ? ` (through ${c.via.fromComponent})` : ""
      return `  - ${c.name} (${c.id}, ${c.type}, owner: ${c.owner || "unassigned"}) — ${via}${through}${flagStr}`
    })
    .join("\n")
}

function buildMemoPrompt(data: BlastRadiusResult): string {
  const high = data.layers
    .flatMap((l) => l.components)
    .filter((c) => c.severity === "high")
  const medium = data.layers
    .flatMap((l) => l.components)
    .filter((c) => c.severity === "medium")
  const transitive = data.layers
    .filter((l) => l.depth >= 2)
    .flatMap((l) => l.components)

  return `You are an architecture analyst writing a short Impact Assessment Memo for management. The component "${data.source.name}" (id: ${data.source.id}, type: ${data.source.type}, status: ${data.source.status}, owner: ${data.source.owner || "unassigned"}) is being analysed for blast radius — what would be affected if it fails, changes, or is removed.

Below is the structured analysis (graph traversal of the architecture catalog). Use ONLY this data. Do not invent components, owners, or relationships that are not listed.

== SUMMARY ==
- Total components affected: ${data.totalImpacted} (${data.directCount} direct, ${data.transitiveCount} transitive)
- Production-status components in blast radius: ${data.productionImpacted}
- NFR gaps (production components without RTO defined): ${data.nfrGaps}
- Components handling confidential or restricted data: ${data.confidentialDataAffected}

== HIGH-SEVERITY IMPACT (${high.length}) ==
${summarizeImpacted(high)}

== MEDIUM-SEVERITY IMPACT (${medium.length}) ==
${summarizeImpacted(medium)}

== TRANSITIVE (depth ≥ 2) (${transitive.length}) ==
${summarizeImpacted(transitive)}

CRITICAL WRITING RULES:
- Write for a CIO/CTO who has 2 minutes. Be direct. No hedging.
- NEVER use words like: leverage, utilize, robust, seamless, comprehensive, streamline, facilitate, holistic, synergy, ecosystem, paradigm, empower, optimize, orchestrate, harness, drive (as in "drives value"), enable (overused), ensure (overused), foster.
- Short sentences. State the risk plainly.
- If a section has no data (e.g., zero high-severity, zero confidential data), say so in one short line. Do not pad.
- Reference specific component names where useful. Do not invent components.

Produce a Markdown document with exactly these sections, in this order:

# Impact Assessment — ${data.source.name}

## Bottom Line
2-3 sentences. What happens if this component fails, and how bad is it. Written for someone who needs to act, not learn.

## Blast Radius Summary
A short bulleted list mirroring the numbers above (total, direct, transitive, production, NFR gaps, confidential data).

## High-Severity Impact
Per high-severity component: name, owner, what breaks, why this matters. Skip if list is empty.

## Medium-Severity Impact
Brief — group by theme (communication breakdowns, fallback load, parent/child orphaning). Skip if list is empty.

## Transitive Effects
Plain-language description of the worst cascading effects. Don't list everything — call out the chains that matter most.

## Risks & Gaps
- NFR gaps you found (specific components missing RTO)
- Confidential data exposure (specific components)
- Single points of failure
- Anything else systemically risky

## Recommended Actions
3-5 concrete, prioritized actions. Each starts with a verb. Plain language. No corporate fluff. Reference specific components or owners where applicable.`
}
