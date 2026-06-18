// POST /api/solutions/ai-compose
//
// AI-assisted solution skeleton. Given the analyst's intent (name + goal
// + description), the LLM reads the whole catalog (the same LLM-friendly
// markdown export used elsewhere) and proposes the rest of the solution:
// delivered capabilities/processes, member components (chosen from real
// catalog ids), gap "new" components, and flows between members.
//
// Reuses the existing LLM client (getLLM) and the catalog export
// (buildCatalogMarkdown). Returns a structured proposal the composer
// wizard pre-fills its steps with — the analyst then edits and creates.

import { NextResponse } from "next/server"
import { listComponents } from "@/lib/github"
import { buildCatalogMarkdown } from "@/lib/catalog-export"
import { getLLM, isLLMConfigured, LLM_DISABLED_MESSAGE } from "@/lib/llm"
import { checkRateLimit } from "@/lib/rate-limit"
import { sanitizeForPrompt } from "@/lib/validate"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"
import { LINK_ROLES, LINK_PROTOCOLS, MEMBER_DISPOSITIONS, PROCESS_STEP_KINDS, PROCESS_ROLES } from "@/lib/constants"
import { slugifyId } from "@/lib/component-schema"
import { getAgent, agentInstruction } from "@/lib/agents"
import type {
  LinkRole,
  LinkProtocol,
  MemberDisposition,
  ProcessActor,
  ProcessRole,
  ProcessStepKind,
  SolutionProcess,
  SolutionProcessStep,
} from "@/lib/types"

const asRole = (v: unknown): ProcessRole | undefined =>
  PROCESS_ROLES.includes(v as ProcessRole) ? (v as ProcessRole) : undefined

export const dynamic = "force-dynamic"

interface Body {
  name?: string
  goal?: string
  description?: string
  // Extracted text of an uploaded source document, used as extra grounding
  // context. Never persisted — passed through for this one composition.
  sourceDoc?: string
}

interface AiMember {
  component: string
  disposition: MemberDisposition
  role?: string
}
interface AiNewComponent {
  name: string
  type: string
  role?: string
}
interface AiFlow {
  from: string
  to: string
  role: LinkRole
  protocol?: LinkProtocol
  status: "existing" | "proposed"
}

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

    let body: Body
    try {
      body = (await request.json()) as Body
    } catch {
      return NextResponse.json({ error: "Body must be JSON." }, { status: 400 })
    }
    // The name is the mandatory seed (goal/description can be empty and are
    // filled by this call). Require at least a name to reason from.
    if (!body.name || body.name.trim() === "") {
      return NextResponse.json(
        { error: "A name is required for AI assist." },
        { status: 400 }
      )
    }

    try {
      const components = await listComponents()
      const catalog = buildCatalogMarkdown(components, {
        generatedAt: new Date().toISOString(),
      })
      const ids = new Set(components.map((c) => c.id))
      const compName = new Map(components.map((c) => [c.id, c.name]))

      const llm = await getLLM()
      const composer = await getAgent("solution-composer")
      const prompt = buildPrompt(
        agentInstruction(composer),
        sanitizeForPrompt(body.name || ""),
        sanitizeForPrompt(body.goal || ""),
        sanitizeForPrompt(body.description || ""),
        sanitizeForPrompt((body.sourceDoc || "").slice(0, 12000)),
        catalog
      )
      const raw = await llm.complete({ prompt, maxTokens: 4096 })
      const parsed = parseJsonObject(raw)

      // Validate / coerce against the catalog and enums. Members and
      // flow endpoints must reference real component ids (the model is
      // told this, but we enforce it); new components are free-form.
      const newComponents: AiNewComponent[] = Array.isArray(parsed.newComponents)
        ? parsed.newComponents
            .filter((n: unknown) => n && typeof n === "object")
            .map((n: Record<string, unknown>) => ({
              name: String(n.name || "").trim(),
              type: typeof n.type === "string" ? n.type : "service",
              role: typeof n.role === "string" ? n.role : undefined,
            }))
            .filter((n: AiNewComponent) => n.name !== "")
        : []

      const members: AiMember[] = Array.isArray(parsed.members)
        ? parsed.members
            .filter((m: unknown) => m && typeof m === "object")
            .map((m: Record<string, unknown>) => ({
              component: String(m.component || "").trim(),
              disposition: MEMBER_DISPOSITIONS.includes(m.disposition as MemberDisposition)
                ? (m.disposition as MemberDisposition)
                : "reuse",
              role: typeof m.role === "string" ? m.role : undefined,
            }))
            .filter((m: AiMember) => ids.has(m.component))
        : []

      const flows: AiFlow[] = Array.isArray(parsed.flows)
        ? parsed.flows
            .filter((f: unknown) => f && typeof f === "object")
            .map((f: Record<string, unknown>) => ({
              from: String(f.from || "").trim(),
              to: String(f.to || "").trim(),
              role: LINK_ROLES.includes(f.role as LinkRole) ? (f.role as LinkRole) : "calls",
              protocol: LINK_PROTOCOLS.includes(f.protocol as LinkProtocol)
                ? (f.protocol as LinkProtocol)
                : undefined,
              status: (f.status === "existing" ? "existing" : "proposed") as "existing" | "proposed",
            }))
            .filter((f: AiFlow) => f.from && f.to && f.from !== f.to)
        : []

      const delivers = {
        capabilities: toStringArray(parsed?.delivers?.capabilities),
      }

      // A starter "main" process sequence, grounded on the proposed members
      // (existing ids + new components by slug). The composer applies it only
      // when it has no processes yet, so it's safe to always return.
      // canonicalId → display name; and a resolver mapping any candidate the
      // model might emit (existing id, new-component slug, or new-component
      // name) to the canonical member id.
      const memberNames = new Map<string, string>()
      const memberResolve = new Map<string, string>()
      for (const m of members) {
        memberNames.set(m.component, compName.get(m.component) || m.component)
        memberResolve.set(m.component.toLowerCase(), m.component)
      }
      for (const n of newComponents) {
        const cid = slugifyId(n.name)
        if (!cid) continue
        memberNames.set(cid, n.name)
        memberResolve.set(cid.toLowerCase(), cid)
        memberResolve.set(n.name.toLowerCase(), cid)
      }
      const process = coerceProcess(parsed.process, memberResolve, memberNames)

      // Suggested goal/description — the composer applies these only when
      // its fields are still empty, so it's safe to always return them.
      const goal = typeof parsed.goal === "string" ? parsed.goal.trim().slice(0, 240) : ""
      const description =
        typeof parsed.description === "string" ? parsed.description.trim().slice(0, 4000) : ""

      getLogger().info("AI solution compose", {
        members: members.length,
        newComponents: newComponents.length,
        flows: flows.length,
      })

      return NextResponse.json({ goal, description, delivers, members, newComponents, flows, process })
    } catch (error) {
      getLogger().error("AI solution compose failed", {
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json(
        { error: `AI compose failed: ${error instanceof Error ? error.message : "Unknown error"}` },
        { status: 500 }
      )
    }
  })
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim() !== "") : []
}

// Validate a proposed process sequence: member actors must reference an
// allowed member id (existing member or new component slug); external actors
// are free-form; steps must reference declared actors. Returns undefined
// when nothing usable was proposed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coerceProcess(raw: any, memberResolve: Map<string, string>, memberNames: Map<string, string>): SolutionProcess | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const actors: ProcessActor[] = []
  const seen = new Set<string>()
  for (const a of Array.isArray(raw.actors) ? raw.actors : []) {
    if (!a || typeof a !== "object") continue
    if (a.kind === "external") {
      const id = String(a.id || "").trim()
      const label = String(a.label || id).trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      actors.push({ id, label, kind: "external", role: asRole(a.role) })
    } else {
      const cand = String(a.component || a.id || "").trim().toLowerCase()
      const component = memberResolve.get(cand)
      if (!component || seen.has(component)) continue
      seen.add(component)
      actors.push({ id: component, label: memberNames.get(component) || component, kind: "member", component, role: asRole(a.role) })
    }
  }
  const actorIds = new Set(actors.map((a) => a.id))

  const steps: SolutionProcessStep[] = []
  for (const s of Array.isArray(raw.steps) ? raw.steps : []) {
    if (!s || typeof s !== "object") continue
    const from = String(s.from || "").trim()
    if (!actorIds.has(from)) continue
    const toRaw = s.to == null ? "" : String(s.to).trim()
    const to = actorIds.has(toRaw) ? toRaw : undefined
    const label = String(s.label || "").trim()
    if (!label) continue
    const kind: ProcessStepKind = PROCESS_STEP_KINDS.includes(s.kind as ProcessStepKind)
      ? (s.kind as ProcessStepKind)
      : "sync"
    const description =
      typeof s.description === "string" && s.description.trim() ? s.description.trim() : undefined
    steps.push({ from, to, label, kind, description })
  }
  if (steps.length === 0) return undefined

  const name = String(raw.name || "Main process").trim() || "Main process"
  return { id: slugifyId(name) || "main-process", name, actors, steps }
}

// Extract the first JSON object from the model output (tolerates code
// fences and surrounding prose).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJsonObject(text: string): Record<string, any> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("Model did not return JSON")
  }
  return JSON.parse(body.slice(start, end + 1))
}

function buildPrompt(
  lead: string,
  name: string,
  goal: string,
  description: string,
  sourceDoc: string,
  catalog: string
): string {
  return `${lead}

From the analyst's intent and the catalog below, propose the solution skeleton. The name is always given; the goal and description may be missing — when so, write them yourself from the name and the source document.

Analyst intent:
- Name: ${name || "(none)"}
- Goal: ${goal || "(none — propose one)"}
- Description: ${description || "(none — propose one)"}
${sourceDoc ? `\nSource document (uploaded requirement — use as grounding, do not quote verbatim):\n${sourceDoc}\n` : ""}
The component catalog (reuse these — pick members by their exact id):
${catalog}

Return ONLY a JSON object, no prose, no code fence, with this exact shape:
{
  "goal": "one concise, outcome-focused sentence (max ~20 words)",
  "description": "2-4 sentences describing what the solution does, who uses it, and what it touches",
  "delivers": { "capabilities": ["..."] },
  "members": [ { "component": "<existing component id>", "disposition": "reuse|extend|external", "role": "what it does in this solution" } ],
  "newComponents": [ { "name": "Human Name", "type": "service|microservice|component|frontend|gateway|database|queue|library", "role": "what it does" } ],
  "flows": [ { "from": "<member id or new component name>", "to": "<member id or new component name>", "role": "calls|serves|reads-from|writes-to|part-of|contains", "protocol": "rest|grpc|async|db|table|file|human|info|link|data", "status": "existing|proposed" } ],
  "process": {
    "name": "Main process",
    "actors": [
      { "id": "<member id>", "kind": "member", "component": "<member id>", "role": "owner|participant|trigger|listener" },
      { "id": "ext:user", "kind": "external", "label": "Customer", "role": "trigger" }
    ],
    "steps": [
      { "from": "<actor id>", "to": "<actor id or null>", "label": "what happens", "kind": "sync|async|return|note" }
    ]
  }
}

Rules:
- Always include "goal" and "description" (write them when the analyst left them blank; otherwise restate theirs faithfully).
- members[].component MUST be an exact id from the catalog. Do not invent ids.
- Put anything that does not exist yet in newComponents (not members).
- Prefer reuse; mark a component "extend" only if it needs changes.
- delivers.capabilities are the business capabilities this solution provides.
- flows describe how the parts interact; use "proposed" for to-be edges.
- "process" is ONE ordered main sequence: actor→target steps. Member actors must use a member id (existing id, or the name of a newComponent). Add external actors (id prefixed "ext:") for people/roles outside the catalog. Give each actor a "role" (owner/participant/trigger/listener). Each step from/to must be a declared actor; use "to": null for an internal action; kind = sync|async|return|note. Keep it short (the analyst refines it).
- Keep it focused: only what the intent implies. Output valid JSON only.`
}
