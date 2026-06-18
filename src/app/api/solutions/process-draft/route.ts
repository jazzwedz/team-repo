// POST /api/solutions/process-draft
//
// Drafts an ordered process sequence (actors + actor→target steps) for a
// solution, grounded in the solution's intent + members (+ optional source
// document). Used by the composer and the solution editor — it takes the
// context in the body rather than a solution id, so it works before the
// solution is saved.
//
// Mirrors ai-compose plumbing. Returns { actors, steps } the editor merges
// into the named process; the analyst then edits.

import { NextResponse } from "next/server"
import { getLLM, isLLMConfigured, LLM_DISABLED_MESSAGE } from "@/lib/llm"
import { checkRateLimit } from "@/lib/rate-limit"
import { sanitizeForPrompt } from "@/lib/validate"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"
import { PROCESS_STEP_KINDS, PROCESS_ROLES } from "@/lib/constants"
import { getAgent, agentInstruction } from "@/lib/agents"
import type { ProcessActor, SolutionProcessStep, ProcessStepKind, ProcessRole } from "@/lib/types"

export const dynamic = "force-dynamic"

interface Body {
  processName?: string
  name?: string
  goal?: string
  description?: string
  members?: { id: string; name: string }[]
  flows?: { from: string; to: string; role?: string; protocol?: string }[]
  sourceDoc?: string
}

const MAX_DOC_CHARS = 12000

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
    const members = Array.isArray(body.members) ? body.members.filter((m) => m && m.id) : []
    if (members.length === 0) {
      return NextResponse.json(
        { error: "Add members to the solution first — a process sequence needs participants." },
        { status: 400 }
      )
    }

    try {
      const llm = await getLLM()
      const drafter = await getAgent("process-drafter")
      const prompt = buildPrompt(agentInstruction(drafter), body, members)
      const raw = await llm.complete({ prompt, maxTokens: 2048 })
      const parsed = parseJsonObject(raw)

      const memberIds = new Set(members.map((m) => m.id))
      const memberName = new Map(members.map((m) => [m.id, m.name]))

      // Validate / coerce actors.
      const actors: ProcessActor[] = []
      const seen = new Set<string>()
      for (const a of Array.isArray(parsed.actors) ? parsed.actors : []) {
        if (!a || typeof a !== "object") continue
        const kind = a.kind === "external" ? "external" : "member"
        const role = PROCESS_ROLES.includes(a.role as ProcessRole) ? (a.role as ProcessRole) : undefined
        if (kind === "member") {
          const component = String(a.component || a.id || "").trim()
          if (!memberIds.has(component) || seen.has(component)) continue
          seen.add(component)
          actors.push({ id: component, label: memberName.get(component) || component, kind: "member", component, role })
        } else {
          const id = String(a.id || "").trim()
          const label = String(a.label || id).trim()
          if (!id || seen.has(id)) continue
          seen.add(id)
          actors.push({ id, label, kind: "external", role })
        }
      }
      const actorIds = new Set(actors.map((a) => a.id))

      // Validate / coerce steps.
      const steps: SolutionProcessStep[] = []
      for (const s of Array.isArray(parsed.steps) ? parsed.steps : []) {
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
        const description = typeof s.description === "string" && s.description.trim() ? s.description.trim() : undefined
        steps.push({ from, to, label, kind, description })
      }

      getLogger().info("Process sequence drafted", { actors: actors.length, steps: steps.length })
      return NextResponse.json({ actors, steps })
    } catch (error) {
      getLogger().error("Process draft failed", {
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json(
        { error: `Process draft failed: ${error instanceof Error ? error.message : "Unknown error"}` },
        { status: 500 }
      )
    }
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJsonObject(text: string): Record<string, any> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const bodyText = fenced ? fenced[1] : text
  const start = bodyText.indexOf("{")
  const end = bodyText.lastIndexOf("}")
  if (start < 0 || end < 0 || end <= start) throw new Error("Model did not return JSON")
  return JSON.parse(bodyText.slice(start, end + 1))
}

function buildPrompt(lead: string, body: Body, members: { id: string; name: string }[]): string {
  const memberLines = members.map((m) => `- ${m.id} (${m.name})`).join("\n")
  const flowLines = (body.flows || [])
    .map((f) => `- ${f.from} → ${f.to}${f.role ? ` (${f.role}${f.protocol ? `/${f.protocol}` : ""})` : ""}`)
    .join("\n")
  const doc = body.sourceDoc ? sanitizeForPrompt(body.sourceDoc.slice(0, MAX_DOC_CHARS)) : ""

  return `${lead}

Draft ONE ordered process sequence for the solution below, as actor→target steps that can render as a sequence diagram.

Solution:
- Name: ${sanitizeForPrompt(body.name || "(none)")}
- Goal: ${sanitizeForPrompt(body.goal || "(none)")}
- Process to model: ${sanitizeForPrompt(body.processName || "(main process)")}
- Description: ${sanitizeForPrompt(body.description || "(none)")}

Members (participants you may use — reference by exact id):
${memberLines || "(none)"}

Existing technical flows (context only):
${flowLines || "(none)"}
${doc ? `\nSource requirement document (context):\n${doc}\n` : ""}
Return ONLY a JSON object, no prose, no code fence, with this shape:
{
  "actors": [
    { "id": "<member id>", "kind": "member", "component": "<member id>", "role": "owner|participant|trigger|listener" },
    { "id": "ext:user", "kind": "external", "label": "Customer", "role": "trigger" }
  ],
  "steps": [
    { "from": "<actor id>", "to": "<actor id or null>", "label": "what happens", "description": "optional detail", "kind": "sync|async|note|return" }
  ]
}

Rules:
- Member actors MUST use an exact member id from the list above (id === component).
- Give each actor a "role": owner / participant / trigger / listener.
- Add external actors (kind "external", id prefixed "ext:") for people/roles/systems not in the members — processes often start with a user.
- Steps are ORDERED. Each from/to must be an actor id you declared.
- Use "to": null for an internal action (rendered as a note).
- kind: "sync" for a call, "async" for fire-and-forget, "return" for a reply, "note" for an internal/aside.
- Keep it focused and grounded — only what the description/document implies. Output valid JSON only.`
}
