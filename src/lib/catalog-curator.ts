// Catalog Curator — reads any uploaded document and proposes catalog
// improvements grounded in it.
//
// Where catalog-enricher is solution-scoped and only ADDS (and only when
// a description is missing), the Curator is document-first and repo-wide:
// it reads a PDF the analyst uploads once (transient — never stored),
// cross-references it against the existing components and solutions, and
// proposes Add / Update / Conflict changes to existing components, each
// with a confidence, a rationale, and a SOURCE citation (page number +
// verbatim quote). Nothing is written until the analyst approves it.
//
// Grounding discipline (anti-hallucination):
//   - the document is fed to the model with explicit page markers, so it
//     can cite a page number;
//   - every proposal's quoted passage is verified to actually appear on
//     the cited page (parseCuratorProposals drops anything that doesn't),
//     so a citation can't be invented.
//
// Trainability: proposals collect 👍/👎 feedback (appendCuratorFeedback);
// a coach pass (buildCuratorCoachPrompt / parseCuratorCoachProposal)
// turns recurring feedback into "lessons" for the catalog-curator agent,
// committed through the normal /api/agents/apply path.

import yaml from "js-yaml"
import { getGit } from "./git"
import { getLogger } from "./log"
import { CAPABILITY_ROLES, RULE_KINDS } from "./constants"
import type { Component, Solution } from "./types"
import type { PdfPage } from "./extractors/pdf"

/** Verdicts below this confidence are dropped (advisory noise floor). */
export const MIN_CONFIDENCE = 0.5
/** Per-component summary caps so the catalog block stays compact. */
const MAX_SUMMARY_CAPS = 12
const MAX_SUMMARY_RULES = 12

export type ProposalChange = "add" | "update" | "conflict"
export type ProposalField = "description" | "capability" | "rule"

export interface CuratorSource {
  page: number
  quote: string
}

export interface CuratorProposal {
  /** Stable id: cur:<componentId>:<field>:<key>. */
  id: string
  componentId: string
  componentName: string
  change: ProposalChange
  field: ProposalField
  /** Present when field === "description". */
  description?: string
  /** Present when field === "capability". */
  capability?: { name: string; role: string; description?: string }
  /** Present when field === "rule". */
  rule?: { name: string; kind: string; summary?: string }
  /** Current value (for update/conflict display). */
  current?: string
  rationale: string
  confidence: number
  source: CuratorSource
}

// ----------------------------- prompt -----------------------------

/** Join pages with explicit markers so the model can cite a page number. */
export function buildPagedText(pages: PdfPage[]): string {
  if (pages.length === 0) return ""
  return pages
    .map((p) => `===== PAGE ${p.num} =====\n${p.text}`)
    .join("\n\n")
}

function componentSummary(c: Component): string {
  const desc = c.description?.description?.trim() || c.description?.oneliner?.trim() || "(none)"
  const caps =
    (c.capabilities || []).slice(0, MAX_SUMMARY_CAPS).map((x) => `${x.name} (${x.role})`).join(", ") ||
    "(none)"
  const rules =
    (c.rules || []).slice(0, MAX_SUMMARY_RULES).map((r) => `${r.name} (${r.kind})`).join(", ") || "(none)"
  return `### ${c.name}  [id: ${c.id}, type: ${c.type}]\nDescription: ${desc}\nCapabilities: ${caps}\nRules: ${rules}`
}

function solutionSummary(s: Solution): string {
  const members = (s.members || []).map((m) => m.component).join(", ") || "(none)"
  return `- ${s.name} [id: ${s.id}]${s.goal ? ` — goal: ${s.goal}` : ""}; members: ${members}`
}

export function buildCuratorPrompt(
  instruction: string,
  pagedText: string,
  components: Component[],
  solutions: Solution[]
): string {
  const catalog = components.map(componentSummary).join("\n\n")
  const sols = solutions.length ? solutions.map(solutionSummary).join("\n") : "(no solutions)"

  return `${instruction}

You are reviewing an uploaded document against an existing architecture catalog. Decide whether the document contains anything worth recording on the EXISTING components below — a better/missing description, a capability, or a business rule — and whether the document CONFIRMS, EXTENDS, or CONTRADICTS what the catalog already says.

Be conservative. Propose a change ONLY when the document clearly and materially supports it. If the catalog already reflects the document, propose nothing. Never invent — every proposal must quote the document verbatim and cite its page.

For each proposal choose:
- componentId: an id from the catalog below (never a new one).
- change: "add" (new info absent from the catalog), "update" (catalog has it but the document is more complete/accurate), or "conflict" (the document contradicts the catalog — flag it, do not silently overwrite).
- field: "description", "capability", or "rule".
  - description: a BUSINESS-focused description (the full proposed text).
  - capability: { name, role one of ${CAPABILITY_ROLES.join("/")}, description }.
  - rule: { name, kind one of ${RULE_KINDS.join("/")}, summary }.
- confidence: 0–1.
- rationale: one sentence — what the document says and why it matters here.
- sourcePage: the page number the evidence is on.
- sourceQuote: the exact passage from that page, quoted verbatim (copy it; do not paraphrase).

EXISTING SOLUTIONS (context only — do not propose changes to these):
${sols}

EXISTING COMPONENTS:
${catalog}

DOCUMENT (with page markers):
"""
${pagedText}
"""

Return ONLY JSON, no prose. Include ONLY components with a real, evidenced change:
{ "proposals": [ { "componentId": "", "change": "add|update|conflict", "field": "description|capability|rule", "description": "", "capability": { "name": "", "role": "", "description": "" }, "rule": { "name": "", "kind": "", "summary": "" }, "confidence": 0.0, "rationale": "", "sourcePage": 1, "sourceQuote": "" } ] }`
}

// ----------------------------- parse / validate -----------------------------

/** Collapse whitespace + lowercase for tolerant verbatim matching. */
function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase()
}

/**
 * Verify a quote really appears in the document and return the page it is
 * actually on (correcting the model's cited page if needed). Returns null
 * when the quote can't be found anywhere — the proposal is then dropped.
 */
function locateQuote(quote: string, citedPage: number, pages: PdfPage[]): number | null {
  const q = normalize(quote)
  if (q.length < 8) return null // too short to trust as a citation
  const cited = pages.find((p) => p.num === citedPage)
  if (cited && normalize(cited.text).includes(q)) return citedPage
  const hit = pages.find((p) => normalize(p.text).includes(q))
  return hit ? hit.num : null
}

export function parseCuratorProposals(
  text: string,
  components: Component[],
  pages: PdfPage[]
): CuratorProposal[] {
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

  const byId = new Map(components.map((c) => [c.id, c]))
  const rawList = Array.isArray(parsed.proposals) ? parsed.proposals : []
  const byProposalId = new Map<string, CuratorProposal>()

  for (const p of rawList as Record<string, unknown>[]) {
    const componentId = typeof p.componentId === "string" ? p.componentId : ""
    const c = byId.get(componentId)
    if (!c) continue

    const field = p.field
    if (field !== "description" && field !== "capability" && field !== "rule") continue
    let change: ProposalChange =
      p.change === "add" || p.change === "update" || p.change === "conflict" ? p.change : "add"

    const confidence = typeof p.confidence === "number" ? Math.max(0, Math.min(1, p.confidence)) : 0
    if (confidence < MIN_CONFIDENCE) continue
    const rationale = typeof p.rationale === "string" ? p.rationale.trim() : ""

    // Grounding: the quote must really appear in the document.
    const quote = typeof p.sourceQuote === "string" ? p.sourceQuote.trim() : ""
    const citedPage = typeof p.sourcePage === "number" ? p.sourcePage : -1
    const page = locateQuote(quote, citedPage, pages)
    if (page === null) continue

    let proposal: CuratorProposal | null = null
    let key = ""

    if (field === "description") {
      const proposed = typeof p.description === "string" ? p.description.trim() : ""
      if (!proposed) continue
      const current = c.description?.description?.trim() || ""
      if (proposed === current) continue // no-op
      change = current ? change === "add" ? "update" : change : "add"
      key = "description"
      proposal = {
        id: `cur:${c.id}:description:_`,
        componentId: c.id,
        componentName: c.name,
        change,
        field,
        description: proposed,
        current: current || undefined,
        rationale,
        confidence,
        source: { page, quote },
      }
    } else if (field === "capability") {
      const cap = p.capability as Record<string, unknown> | undefined
      const name = cap && typeof cap.name === "string" ? cap.name.trim() : ""
      if (!name) continue
      const role = cap && CAPABILITY_ROLES.includes(cap.role as never) ? (cap.role as string) : "indirect"
      const description = cap && typeof cap.description === "string" ? cap.description.trim() : undefined
      const existing = (c.capabilities || []).find((x) => (x.name || "").toLowerCase() === name.toLowerCase())
      change = existing ? (change === "add" ? "update" : change) : "add"
      key = name.toLowerCase()
      proposal = {
        id: `cur:${c.id}:capability:${key}`,
        componentId: c.id,
        componentName: c.name,
        change,
        field,
        capability: { name, role, description },
        current: existing ? `${existing.name} (${existing.role})${existing.description ? ` — ${existing.description}` : ""}` : undefined,
        rationale,
        confidence,
        source: { page, quote },
      }
    } else {
      const r = p.rule as Record<string, unknown> | undefined
      const name = r && typeof r.name === "string" ? r.name.trim() : ""
      if (!name) continue
      const kind = r && RULE_KINDS.includes(r.kind as never) ? (r.kind as string) : "rule"
      const summary = r && typeof r.summary === "string" ? r.summary.trim() : undefined
      const existing = (c.rules || []).find((x) => (x.name || "").toLowerCase() === name.toLowerCase())
      change = existing ? (change === "add" ? "update" : change) : "add"
      key = name.toLowerCase()
      proposal = {
        id: `cur:${c.id}:rule:${key}`,
        componentId: c.id,
        componentName: c.name,
        change,
        field,
        rule: { name, kind, summary },
        current: existing ? `${existing.name} (${existing.kind})${existing.summary ? ` — ${existing.summary}` : ""}` : undefined,
        rationale,
        confidence,
        source: { page, quote },
      }
    }

    if (proposal && !byProposalId.has(proposal.id)) byProposalId.set(proposal.id, proposal)
  }

  return Array.from(byProposalId.values()).sort((a, b) => b.confidence - a.confidence)
}

// ----------------------------- feedback store -----------------------------
//
// Append-only feedback on Curator proposals, stored as a single YAML file
// in the data repo. The coach reads items newer than its watermark.

export interface CuratorFeedback {
  id?: string
  rating: "up" | "down"
  /** One-line description of the proposal the feedback is about. */
  proposalSummary?: string
  comment?: string
  at: string
  by?: string
  resolved?: boolean
}

const FEEDBACK_PATH = "agents/_curator-feedback.yaml"
const COACH_STATE_PATH = "agents/_curator-coach-state.yaml"

export async function getCuratorFeedback(): Promise<CuratorFeedback[]> {
  try {
    const file = await getGit().getFile(FEEDBACK_PATH)
    const o = yaml.load(file.content, { schema: yaml.JSON_SCHEMA }) as { items?: CuratorFeedback[] } | null
    return Array.isArray(o?.items) ? o!.items : []
  } catch {
    return []
  }
}

export async function appendCuratorFeedback(fb: CuratorFeedback): Promise<void> {
  const git = getGit()
  let items: CuratorFeedback[] = []
  let sha: string | undefined
  try {
    const file = await git.getFile(FEEDBACK_PATH)
    sha = file.sha
    const o = yaml.load(file.content, { schema: yaml.JSON_SCHEMA }) as { items?: CuratorFeedback[] } | null
    if (Array.isArray(o?.items)) items = o!.items
  } catch {
    // file doesn't exist yet
  }
  items.push(fb)
  await git.putFile(
    FEEDBACK_PATH,
    yaml.dump({ items }, { lineWidth: -1, noRefs: true }),
    "chore(curator): record proposal feedback",
    sha
  )
  getLogger().info("Curator feedback recorded", { rating: fb.rating })
}

// ----------------------------- coach -----------------------------

export async function getCuratorCoachWatermark(): Promise<string> {
  try {
    const file = await getGit().getFile(COACH_STATE_PATH)
    const o = yaml.load(file.content, { schema: yaml.JSON_SCHEMA }) as { lastTrainedAt?: string } | null
    return typeof o?.lastTrainedAt === "string" ? o.lastTrainedAt : ""
  } catch {
    return ""
  }
}

export async function setCuratorCoachWatermark(at: string): Promise<void> {
  const git = getGit()
  let sha: string | undefined
  try {
    sha = (await git.getFile(COACH_STATE_PATH)).sha
  } catch {
    // not created yet
  }
  await git.putFile(
    COACH_STATE_PATH,
    yaml.dump({ lastTrainedAt: at }, { lineWidth: -1 }),
    "chore(curator): advance coach training watermark",
    sha
  )
}

export interface CuratorCoachProposal {
  rationale: string
  /** Full proposed lessons block for the catalog-curator agent. */
  lessons: string
  feedbackConsidered: number
}

export function buildCuratorCoachPrompt(
  currentPrompt: string,
  currentLessons: string,
  feedback: CuratorFeedback[]
): string {
  const digest = feedback
    .map((f, i) => `${i + 1}. [${f.rating}]${f.proposalSummary ? ` (${f.proposalSummary})` : ""}${f.comment ? ` · "${f.comment}"` : ""}`)
    .join("\n")

  return `You are a coach who improves the Catalog Curator agent — it reads documents and proposes catalog improvements. You are given its current instruction and recent analyst feedback on its proposals (👍/👎 with optional comments). Identify recurring problems (over-eager proposals, weak rationales, missing the point) and produce an improved "lessons" block: concrete, minimal rules the agent should follow. Keep what already works; add targeted guidance from the feedback. Do not rewrite the whole persona.

CURRENT PROMPT:
${currentPrompt}

CURRENT LESSONS:
${currentLessons || "(none yet)"}

RECENT FEEDBACK (newest first):
${digest || "(none)"}

Return ONLY JSON, no prose:
{ "rationale": "<what you changed and why>", "lessons": "<the full updated lessons block>" }`
}

export function parseCuratorCoachProposal(text: string, feedbackCount: number): CuratorCoachProposal | null {
  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    const body = fenced ? fenced[1] : text
    const start = body.indexOf("{")
    const end = body.lastIndexOf("}")
    if (start < 0 || end < 0) return null
    const o = JSON.parse(body.slice(start, end + 1)) as { rationale?: unknown; lessons?: unknown }
    const lessons = typeof o.lessons === "string" ? o.lessons.trim() : ""
    if (!lessons) return null
    return {
      rationale: typeof o.rationale === "string" ? o.rationale.trim() : "",
      lessons,
      feedbackConsidered: feedbackCount,
    }
  } catch {
    return null
  }
}
