// AI relationship auditor — finds links that *should* exist but are
// declared by neither component.
//
// The deterministic consistency check (consistency.ts) only audits the
// symmetry of edges that already exist (duplicate links, missing
// mirrors). It is blind to a relationship that no one declared at all.
// Inferring those is a semantic judgement, so it is AI-assisted and
// strictly advisory: every result carries a confidence + a rationale,
// nothing is written until the analyst approves it.
//
// Two-phase "candidate → judge" pipeline (keeps the LLM bounded and
// grounded; no O(n²) prompt):
//
//   Phase A — generateCandidates(): deterministic, no LLM. Produces a
//     ranked, capped set of component pairs that have NO link between
//     them but show cheap signals they should (a solution flow, a
//     shared data component, a textual mention, shared solution
//     membership). Each candidate carries concrete evidence strings.
//
//   Phase B — the route calls the relationship-auditor agent with the
//     candidates (see buildAuditPrompt), then maps the verdicts back to
//     advisory ConsistencyIssues via parseAuditVerdicts.
//
// Only the PRIMARY edge is proposed (e.g. A→calls→B). Once applied, the
// next deterministic scan surfaces the missing mirror (B→serves→A) as a
// normal `links` issue — so the mirror logic is never duplicated here.

import type { Component, Solution } from "./types"
import { LINK_ROLES, LINK_PROTOCOLS, LINK_ROLE_LABELS } from "./constants"
import type { ConsistencyIssue } from "./consistency"

/** Hard cap on pairs handed to the LLM — keeps the prompt and cost bounded. */
export const MAX_CANDIDATES = 40
/** Verdicts below this confidence are dropped (advisory noise floor). */
export const MIN_CONFIDENCE = 0.5
/** Names shorter than this are skipped in text-mention matching (too noisy). */
const MIN_NAME_LEN = 4

export interface RelationshipCandidate {
  /** Component id. */
  a: string
  /** Component id. */
  b: string
  /** Human-readable evidence snippets (shown to the LLM as grounding). */
  evidence: string[]
  /** Sum of signal weights — higher = stronger prior that a link is missing. */
  score: number
}

// ----------------------------- candidate generation -----------------------------

/** Unordered pair key so (a,b) and (b,a) collapse to one candidate. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`
}

/** True when either component already declares a link toward the other. */
function hasLinkBetween(a: Component, b: Component): boolean {
  const aToB = (a.links || []).some((l) => l.target === b.id)
  const bToA = (b.links || []).some((l) => l.target === a.id)
  return aToB || bToA
}

/** Lower-cased haystack of a component's prose for text-mention matching. */
function searchText(c: Component): string {
  const parts: string[] = [c.name, c.description?.oneliner || "", c.description?.description || ""]
  for (const cap of c.capabilities || []) parts.push(cap.name, cap.description || "")
  for (const r of c.rules || []) parts.push(r.name, r.summary || "")
  return parts.join(" \n ").toLowerCase()
}

/** Whether `text` mentions `name` as a whole word (avoids substring noise). */
function mentions(text: string, name: string): boolean {
  const n = name.trim().toLowerCase()
  if (n.length < MIN_NAME_LEN) return false
  const i = text.indexOf(n)
  if (i < 0) return false
  const before = i === 0 ? " " : text[i - 1]
  const after = i + n.length >= text.length ? " " : text[i + n.length]
  return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)
}

/**
 * Build the capped, ranked candidate set. Pure function — no I/O.
 * `components` is the full catalog; `solutions` are all solutions (their
 * flows and membership are the strongest signals).
 */
export function generateCandidates(
  components: Component[],
  solutions: Solution[]
): RelationshipCandidate[] {
  const byId = new Map(components.map((c) => [c.id, c]))
  const cand = new Map<string, RelationshipCandidate>()

  // add: register/merge a signal on an unordered pair, after the core
  // filter — both ids must be real components with NO link between them.
  const add = (aId: string, bId: string, evidence: string, score: number) => {
    if (aId === bId) return
    const a = byId.get(aId)
    const b = byId.get(bId)
    if (!a || !b) return
    if (hasLinkBetween(a, b)) return
    const key = pairKey(aId, bId)
    const existing = cand.get(key)
    if (existing) {
      existing.score += score
      if (!existing.evidence.includes(evidence)) existing.evidence.push(evidence)
    } else {
      cand.set(key, { a: aId, b: bId, evidence: [evidence], score })
    }
  }

  // Signal 1 — solution flows. A flow is an explicit to-be (or claimed
  // existing) interaction between two members; if the catalog has no
  // link for it, that is a prime missing relationship. "existing" flows
  // claim the edge is already real, so they score higher.
  for (const sol of solutions) {
    for (const f of sol.flows || []) {
      if (!f.from || !f.to) continue
      const strong = f.status === "existing"
      add(
        f.from,
        f.to,
        `Solution "${sol.name}" declares a ${f.status} flow ${f.from} →(${f.role}) ${f.to}, but the catalog has no link between them.`,
        strong ? 6 : 4
      )
    }
  }

  // Signal 2 — shared data component. A writes to data component T that
  // B reads from (or vice-versa) implies a possible data dependency
  // between the two app components.
  const writers = new Map<string, Set<string>>() // dataTarget -> writer ids
  const readers = new Map<string, Set<string>>() // dataTarget -> reader ids
  for (const c of components) {
    for (const l of c.links || []) {
      if (!l.target) continue
      if (l.role === "writes-to") (writers.get(l.target) ?? writers.set(l.target, new Set()).get(l.target)!).add(c.id)
      if (l.role === "reads-from") (readers.get(l.target) ?? readers.set(l.target, new Set()).get(l.target)!).add(c.id)
    }
  }
  for (const [dataTarget, ws] of writers) {
    const rs = readers.get(dataTarget)
    if (!rs) continue
    const dataName = byId.get(dataTarget)?.name || dataTarget
    for (const w of ws) {
      for (const r of rs) {
        add(
          w,
          r,
          `${byId.get(w)?.name || w} writes to "${dataName}" which ${byId.get(r)?.name || r} reads — possible data dependency.`,
          3
        )
      }
    }
  }

  // Signal 3 — textual mention. A's prose names B (whole-word) → A likely
  // relates to B. Bounded by MIN_NAME_LEN and the no-existing-link filter.
  const texts = components.map((c) => ({ c, text: searchText(c) }))
  for (const { c: a, text } of texts) {
    for (const b of components) {
      if (a.id === b.id) continue
      if (mentions(text, b.name)) {
        add(a.id, b.id, `${a.name}'s description mentions "${b.name}".`, 4)
      }
    }
  }

  // Signal 4 — shared solution membership. A weak booster only: it adds
  // weight + context to pairs already surfaced above, but does NOT create
  // new candidates on its own (avoids m² low-signal pairs per solution).
  for (const sol of solutions) {
    const memberIds = (sol.members || []).map((m) => m.component)
    for (let i = 0; i < memberIds.length; i++) {
      for (let j = i + 1; j < memberIds.length; j++) {
        const key = pairKey(memberIds[i], memberIds[j])
        const existing = cand.get(key)
        if (existing) {
          existing.score += 1
          const ev = `Both are members of solution "${sol.name}".`
          if (!existing.evidence.includes(ev)) existing.evidence.push(ev)
        }
      }
    }
  }

  // Orphan boost — if either side has no links at all, a missing
  // relationship is more likely to matter; nudge it up the list.
  for (const c of cand.values()) {
    const a = byId.get(c.a)
    const b = byId.get(c.b)
    if ((a && (a.links || []).length === 0) || (b && (b.links || []).length === 0)) {
      c.score += 1
    }
  }

  return Array.from(cand.values())
    .sort((x, y) => y.score - x.score)
    .slice(0, MAX_CANDIDATES)
}

// ----------------------------- prompt -----------------------------

export function buildAuditPrompt(
  instruction: string,
  candidates: RelationshipCandidate[],
  byId: Map<string, Component>
): string {
  const profile = (id: string): string => {
    const c = byId.get(id)
    if (!c) return id
    const desc = c.description?.oneliner?.trim() || c.description?.description?.trim() || "(no description)"
    return `${c.name} [id: ${c.id}, type: ${c.type}] — ${desc}`
  }

  const blocks = candidates
    .map((cand, i) => {
      const ev = cand.evidence.map((e) => `  - ${e}`).join("\n")
      return `## Candidate ${i + 1}
A = ${profile(cand.a)}
B = ${profile(cand.b)}
Evidence:
${ev}`
    })
    .join("\n\n")

  return `${instruction}

You are auditing a component catalog for MISSING relationships. Below are candidate pairs of components that currently have NO link between them, each with concrete evidence. For each pair, decide whether a link SHOULD exist in the catalog.

Be conservative: propose a link ONLY when the evidence clearly supports it. Reject weak, speculative, or coincidental pairs by omitting them. Never invent components or evidence — use only the ids and evidence given.

When you DO propose a link, give:
- from / to: the component ids (must be the A and B of that candidate; pick the real direction).
- role: one of ${LINK_ROLES.join(", ")}.
- protocol (optional): one of ${LINK_PROTOCOLS.join(", ")}.
- confidence: 0–1.
- rationale: one sentence citing the evidence.

CANDIDATES:
${blocks}

Return ONLY JSON, no prose. Include ONLY pairs that should be linked; omit the rest:
{ "links": [ { "from": "<id>", "to": "<id>", "role": "<role>", "protocol": "<protocol|omit>", "confidence": 0.0, "rationale": "<why>" } ] }`
}

// ----------------------------- parse -----------------------------

/**
 * Map the LLM's verdicts to advisory ConsistencyIssues. Validates hard
 * against the candidate set and the catalog: a verdict survives only if
 * from/to are a real candidate pair, the role/protocol are valid enums,
 * the confidence clears MIN_CONFIDENCE, and the pair still has no link
 * (defensive). The proposed `addLink` lands on `from`; the mirror is
 * left to the deterministic checker on the next scan.
 */
export function parseAuditVerdicts(
  text: string,
  candidates: RelationshipCandidate[],
  byId: Map<string, Component>
): ConsistencyIssue[] {
  let parsed: { links?: unknown }
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

  const candKeys = new Set(candidates.map((c) => pairKey(c.a, c.b)))
  const rawList = Array.isArray(parsed.links) ? parsed.links : []
  const byIssueId = new Map<string, ConsistencyIssue>()

  for (const v of rawList as Record<string, unknown>[]) {
    const from = typeof v.from === "string" ? v.from : ""
    const to = typeof v.to === "string" ? v.to : ""
    const fromC = byId.get(from)
    const toC = byId.get(to)
    if (!fromC || !toC || from === to) continue
    // Must be one of the candidate pairs we offered (anti-hallucination).
    if (!candKeys.has(pairKey(from, to))) continue
    // Defensive: skip if a link already exists either way.
    if (hasLinkBetween(fromC, toC)) continue

    const role = typeof v.role === "string" && LINK_ROLES.includes(v.role as never) ? (v.role as (typeof LINK_ROLES)[number]) : null
    if (!role) continue
    const protocol =
      typeof v.protocol === "string" && LINK_PROTOCOLS.includes(v.protocol as never)
        ? (v.protocol as (typeof LINK_PROTOCOLS)[number])
        : undefined
    const confidence = typeof v.confidence === "number" ? Math.max(0, Math.min(1, v.confidence)) : 0
    if (confidence < MIN_CONFIDENCE) continue
    const rationale = typeof v.rationale === "string" ? v.rationale.trim() : ""

    const id = `ai:${from}:${role}:${protocol ?? ""}:${to}`
    if (byIssueId.has(id)) continue
    byIssueId.set(id, {
      id,
      category: "inferred-links",
      source: "ai",
      confidence,
      rationale,
      applyTo: from,
      applyToName: fromC.name,
      declaredOn: from,
      declaredOnName: fromC.name,
      title: `${fromC.name} should declare "${LINK_ROLE_LABELS[role]}: ${toC.name}"`,
      details: rationale || `${fromC.name} and ${toC.name} look related but neither declares a link.`,
      fix: {
        kind: "addLink",
        link: {
          target: to,
          role,
          ...(protocol ? { protocol } : {}),
          ...(rationale ? { description: rationale } : {}),
        },
      },
    })
  }

  return Array.from(byIssueId.values()).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
}
