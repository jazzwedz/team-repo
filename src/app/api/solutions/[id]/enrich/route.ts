// POST /api/solutions/[id]/enrich
//
// "Enrich the catalog from what we learned." Reads the solution's member
// components (their current catalog entries) plus the source requirements
// document(s) stored on the solution, and asks the catalog-enricher agent
// to PROPOSE business-focused improvements — a clearer description, new
// capabilities, new business rules — per component. Returns proposals only;
// nothing is written. The analyst reviews and applies them via the normal
// component save (which is sha/lock-guarded).

import { NextResponse } from "next/server"
import { getSolution } from "@/lib/solutions"
import { listComponents } from "@/lib/github"
import { isValidName } from "@/lib/validate"
import { isLLMConfigured, LLM_DISABLED_MESSAGE, getLLM } from "@/lib/llm"
import { checkRateLimit } from "@/lib/rate-limit"
import { getCombinedSourceText } from "@/lib/source-docs-store"
import { getAgent, agentInstruction } from "@/lib/agents"
import { CAPABILITY_ROLES, RULE_KINDS } from "@/lib/constants"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"
import type { Component, Solution } from "@/lib/types"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const BRD_CAP = 14000
// Hard backstop on additive proposals per component (capabilities / rules)
// so a single run can't balloon the catalog even if the model over-eagers.
const MAX_ADDITIONS = 3

interface CapProposal {
  name: string
  role: string
  description?: string
  rationale?: string
}
interface RuleProposal {
  name: string
  kind: string
  summary?: string
  rationale?: string
}
interface Proposal {
  componentId: string
  componentName: string
  currentDescription: string
  description?: { proposed: string; rationale?: string }
  capabilities: CapProposal[]
  rules: RuleProposal[]
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRouteContext(request, async () => {
    const { id } = await params
    if (!isValidName(id)) {
      return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
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
      const solution = await getSolution(id)
      const components = await listComponents()
      const byId = new Map(components.map((c) => [c.id, c]))
      const members = (solution.members || [])
        .map((m) => byId.get(m.component))
        .filter((c): c is Component => !!c)
      if (members.length === 0) {
        return NextResponse.json({ proposals: [] })
      }

      const brd = await getCombinedSourceText(id, BRD_CAP).catch(() => null)
      const agent = await getAgent("catalog-enricher")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const llm: any = await getLLM()
      const raw: string = await llm.complete({
        prompt: enrichPrompt(agentInstruction(agent), solution, members, brd?.text),
        maxTokens: 4000,
      })

      const proposals = parseProposals(raw, members)
      return NextResponse.json({ proposals })
    } catch (error) {
      getLogger().error("Failed to propose catalog enrichment", {
        id,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json(
        { error: `Failed to enrich: ${error instanceof Error ? error.message : "Unknown error"}` },
        { status: 500 }
      )
    }
  })
}

function enrichPrompt(
  instruction: string,
  solution: Solution,
  members: Component[],
  brdText: string | undefined
): string {
  const memberBlocks = members
    .map((c) => {
      const caps = (c.capabilities || []).map((x) => `${x.name} (${x.role})`).join(", ") || "(none)"
      const rules = (c.rules || []).map((r) => `${r.name} (${r.kind})`).join(", ") || "(none)"
      const desc = c.description?.description?.trim() || "(none)"
      return `### ${c.name}  [id: ${c.id}, type: ${c.type}]\nCurrent description: ${desc}\nCurrent capabilities: ${caps}\nCurrent rules: ${rules}`
    })
    .join("\n\n")

  const hasBrd = !!brdText?.trim()
  const brd = hasBrd
    ? `\nSOURCE REQUIREMENTS DOCUMENT (BRD) — the ONLY evidence for new capabilities/rules:\n"""\n${brdText!.trim()}\n"""\n`
    : `\n(No source requirements document is stored on this solution.)\n`

  // Without a BRD we have no external evidence, so the only safe change is
  // completing a missing/empty description. With a BRD, allow a few
  // high-confidence additions but bias hard toward proposing nothing.
  const capRuleRule = hasBrd
    ? `- capabilities: AT MOST 3 — business capabilities the BRD explicitly describes for this component and that are clearly missing (role one of: ${CAPABILITY_ROLES.join(", ")}). Prefer none.
- rules: AT MOST 3 — business rules/calculations the BRD explicitly states and that are clearly missing (kind one of: ${RULE_KINDS.join(", ")}). Prefer none.`
    : `- capabilities: propose NONE (no source evidence available).
- rules: propose NONE (no source evidence available).`

  return `${instruction}

Improve the catalog for the components of the solution "${solution.name}"${solution.goal ? ` (goal: ${solution.goal})` : ""}.

Be CONSERVATIVE. The default is to propose NOTHING. Only propose a change when the evidence clearly and materially improves the catalog. If a component already adequately reflects the evidence, omit it entirely. Re-running this on an already-good catalog must return an empty list. Never invent; never propose stylistic rewrites; never re-list something already present.

For each component you DO change, propose only:
- description: a BUSINESS-focused description — ONLY when the current one is missing, empty, or clearly incomplete/inaccurate versus the evidence. Do NOT rewrite an adequate description.
${capRuleRule}

COMPONENTS (current catalog state):
${memberBlocks}
${brd}
Return ONLY JSON, no prose. Include ONLY components with at least one real change; omit empty fields/arrays:
{ "proposals": [ { "componentId": "<id>", "description": { "proposed": "<text>", "rationale": "<why>" }, "capabilities": [ { "name": "", "role": "", "description": "", "rationale": "" } ], "rules": [ { "name": "", "kind": "", "summary": "", "rationale": "" } ] } ] }`
}

function parseProposals(text: string, members: Component[]): Proposal[] {
  const byId = new Map(members.map((c) => [c.id, c]))
  let parsed: { proposals?: unknown }
  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    const body = fenced ? fenced[1] : text
    const start = body.indexOf("{")
    const end = body.lastIndexOf("}")
    if (start < 0 || end < 0) return []
    parsed = JSON.parse(body.slice(start, end + 1))
  } catch {
    return []
  }
  const rawList = Array.isArray(parsed.proposals) ? parsed.proposals : []
  const out: Proposal[] = []
  for (const p of rawList as Record<string, unknown>[]) {
    const cid = typeof p.componentId === "string" ? p.componentId : ""
    const c = byId.get(cid)
    if (!c) continue
    const existingCaps = new Set((c.capabilities || []).map((x) => (x.name || "").toLowerCase()))
    const existingRules = new Set((c.rules || []).map((r) => (r.name || "").toLowerCase()))

    // description
    let description: Proposal["description"] | undefined
    const d = p.description as Record<string, unknown> | undefined
    if (d && typeof d.proposed === "string" && d.proposed.trim()) {
      const proposed = d.proposed.trim()
      // Skip a no-op proposal identical to the current text.
      if (proposed !== (c.description?.description?.trim() || "")) {
        description = { proposed, rationale: typeof d.rationale === "string" ? d.rationale : undefined }
      }
    }

    // capabilities — only valid roles, not already present
    const capabilities: CapProposal[] = (Array.isArray(p.capabilities) ? p.capabilities : [])
      .map((x) => x as Record<string, unknown>)
      .filter((x) => typeof x.name === "string" && (x.name as string).trim())
      .filter((x) => !existingCaps.has((x.name as string).trim().toLowerCase()))
      .map((x) => ({
        name: (x.name as string).trim(),
        role: CAPABILITY_ROLES.includes(x.role as never) ? (x.role as string) : "indirect",
        description: typeof x.description === "string" ? x.description : undefined,
        rationale: typeof x.rationale === "string" ? x.rationale : undefined,
      }))
      .slice(0, MAX_ADDITIONS)

    // rules — only valid kinds, not already present
    const rules: RuleProposal[] = (Array.isArray(p.rules) ? p.rules : [])
      .map((x) => x as Record<string, unknown>)
      .filter((x) => typeof x.name === "string" && (x.name as string).trim())
      .filter((x) => !existingRules.has((x.name as string).trim().toLowerCase()))
      .map((x) => ({
        name: (x.name as string).trim(),
        kind: RULE_KINDS.includes(x.kind as never) ? (x.kind as string) : "rule",
        summary: typeof x.summary === "string" ? x.summary : undefined,
        rationale: typeof x.rationale === "string" ? x.rationale : undefined,
      }))
      .slice(0, MAX_ADDITIONS)

    if (!description && capabilities.length === 0 && rules.length === 0) continue
    out.push({
      componentId: c.id,
      componentName: c.name,
      currentDescription: c.description?.description?.trim() || "",
      description,
      capabilities,
      rules,
    })
  }
  return out
}
