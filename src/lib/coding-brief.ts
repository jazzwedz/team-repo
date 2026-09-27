// Coding brief — one self-contained Markdown work order for a coding agent
// (Claude Code style), generated alongside a Functional Specification.
//
// The FS is written for people: a document with a cover, chapters and
// tables. A coding agent needs the same content as a task file: what to
// build, where in the codebase, in which order, with which rules and
// tests, and where to STOP and ask. This module derives that file:
//   - deterministically from the catalog facts and the FS itself (codebase
//     map with mapped source paths, use cases with flows and rule ids, the
//     rules register, and the FS chapters that matter to an implementer —
//     scope, acceptance criteria, NFRs, open points — quoted verbatim),
//   - plus ONE model call for the narrative parts (mission, per-use-case
//     implementation notes, open questions, suggested order of work),
//     returned as JSON; when the model is unavailable or fails the brief
//     is still produced without those parts.
//
// Always English — coding agents read English regardless of the FS language.

import type { Component, Solution } from "./types"
import { fsSeeds, ruleDetail, type FsSeeds } from "./fs-usecases"
import { normTitle } from "./doc-chapters"
import { parseLlmJson } from "./llm/json"

export interface CodingBriefInput {
  solution: Solution
  components: Component[]
  /** The grounded facts the FS was generated from. */
  facts: string
  /** The generated FS (markdown). */
  fsMarkdown: string
  fsTitle: string
  /** LLM provider (getLLM()); omit for a deterministic-only brief. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  llm?: any
}

interface Narrative {
  mission?: string
  ucNotes?: Record<string, string>
  openQuestions?: string[]
  plan?: string[]
}

const FS_CAP = 60000
const FACTS_CAP = 30000
const CHAPTER_CAP = 12000

/** Body of the FS chapter whose "## N. Title" heading matches `titleLike`
 *  loosely (number ignored, "&" = "and", punctuation ignored); "" if absent. */
export function extractChapter(md: string, titleLike: string): string {
  const want = normTitle(titleLike)
  for (const part of md.split(/\n(?=##\s)/)) {
    const m = part.match(/^##\s+(.+)/)
    if (!m) continue
    const key = normTitle(m[1])
    if (key === want || key.includes(want)) {
      const body = part.replace(/^##\s+.+\n?/, "").trim()
      return body.length > CHAPTER_CAP ? body.slice(0, CHAPTER_CAP) + "\n\n…(truncated — see the FS)" : body
    }
  }
  return ""
}

/** Table rows (or bullet lines) of a chapter that mention the given id. */
function linesMentioning(body: string, id: string): string[] {
  return body
    .split("\n")
    .filter((l) => l.includes(id) && (l.trim().startsWith("|") || l.trim().startsWith("-")))
    .filter((l) => !/^\|\s*-+/.test(l.trim()))
}

function ucFlow(seed: FsSeeds["ucs"][number]): string[] {
  const p = seed.process
  const actorLabel = (aid: string) => {
    const a = (p.actors || []).find((x) => x.id === aid)
    return a ? a.label || a.component || a.id : aid
  }
  return (p.steps || []).map((s, i) => {
    const kind = s.kind || "sync"
    return !s.to || kind === "note"
      ? `${i + 1}. ${actorLabel(s.from)} — ${s.label}${s.description ? `: ${s.description}` : ""}`
      : `${i + 1}. ${actorLabel(s.from)} → ${actorLabel(s.to)} (${kind}): ${s.label}${s.description ? ` — ${s.description}` : ""}`
  })
}

function narrativePrompt(input: CodingBriefInput, seeds: FsSeeds): string {
  const fs = input.fsMarkdown.length > FS_CAP ? input.fsMarkdown.slice(0, FS_CAP) + "\n…(truncated)" : input.fsMarkdown
  const facts = input.facts.length > FACTS_CAP ? input.facts.slice(0, FACTS_CAP) + "\n…(truncated)" : input.facts
  const ucIds = seeds.ucs.map((u) => `${u.id} (${u.process.name})`).join(", ") || "(no use cases modelled)"
  return `You are a senior engineer turning a Functional Specification into a work order for an autonomous coding agent. Write in English, plainly, for an engineer who has never seen this system. Ground everything in the specification and the facts below; never invent components, endpoints, fields or values.

Return ONLY a JSON object, no prose, no code fence:
{
  "mission": "one paragraph (3-5 sentences): what must be built, for whom, what changes in which existing components, and what the result must achieve",
  "ucNotes": { "UC-01": "2-5 sentences of implementation guidance for this use case: which component(s) change and how, data touched, interfaces called, edge cases and error handling the spec implies" },
  "openQuestions": ["a question the agent must ask a human before implementing (missing values, undecided options, contradictions) — one per item"],
  "plan": ["ordered step of work (each one a self-contained, reviewable increment; reference UC/RG ids)"]
}

Use cases to cover in ucNotes (use these EXACT keys): ${ucIds}

FUNCTIONAL SPECIFICATION:
${fs}

VERIFIED FACTS:
${facts}

Output only the JSON.`
}

async function narrative(input: CodingBriefInput, seeds: FsSeeds): Promise<Narrative> {
  if (!input.llm) return {}
  const raw: string = await input.llm.complete({ prompt: narrativePrompt(input, seeds), maxTokens: 4000 })
  const parsed = (await parseLlmJson(raw, (o) => input.llm.complete(o))) as Narrative
  const notes: Record<string, string> = {}
  if (parsed.ucNotes && typeof parsed.ucNotes === "object") {
    for (const [k, v] of Object.entries(parsed.ucNotes)) if (typeof v === "string" && v.trim()) notes[k.trim().toUpperCase()] = v.trim()
  }
  return {
    mission: typeof parsed.mission === "string" ? parsed.mission.trim() : undefined,
    ucNotes: notes,
    openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions.filter((x) => typeof x === "string" && x.trim()) : [],
    plan: Array.isArray(parsed.plan) ? parsed.plan.filter((x) => typeof x === "string" && x.trim()) : [],
  }
}

const cell = (s: string | undefined) => (s || "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim()

/** Build the brief. Never throws on model failure — the narrative parts are
 *  simply marked as not generated. */
export async function generateCodingBrief(input: CodingBriefInput): Promise<string> {
  const { solution, components } = input
  const byId = new Map(components.map((c) => [c.id, c]))
  const seeds = fsSeeds(solution, components)
  const today = new Date().toISOString().slice(0, 10)

  let n: Narrative = {}
  let narrativeError: string | undefined
  try {
    n = await narrative(input, seeds)
  } catch (e) {
    narrativeError = e instanceof Error ? e.message : String(e)
  }

  const scope = extractChapter(input.fsMarkdown, "Scope")
  const acceptance = extractChapter(input.fsMarkdown, "Acceptance Criteria")
  const nfr = extractChapter(input.fsMarkdown, "Non-Functional Requirements")
  const openPoints = extractChapter(input.fsMarkdown, "Assumptions, Decisions & Open Points")
  const data = extractChapter(input.fsMarkdown, "Data Requirements")
  const interfaces = extractChapter(input.fsMarkdown, "Interfaces, Batches & Notifications")

  const out: string[] = []
  out.push(`# Coding brief — ${solution.name}`)
  out.push(``)
  out.push(
    `> Generated by Team Repository on ${today} from the Functional Specification "${input.fsTitle}". One file, self-contained: everything an implementation agent needs is here. The FS is the source of truth for behaviour — where this brief and the FS disagree, the FS wins.`
  )
  if (narrativeError) out.push(`> Note: the narrative sections (mission, notes, plan) could not be generated (${narrativeError}); the deterministic content is complete.`)
  out.push(``)

  // 1. Mission
  out.push(`## 1. Mission`)
  out.push(``)
  out.push(
    n.mission ||
      [solution.goal ? `Goal: ${solution.goal}` : "", solution.description?.description || "", "(Mission narrative not generated — read the Introduction of the FS.)"]
        .filter(Boolean)
        .join("\n\n")
  )
  out.push(``)

  // 2. Rules of engagement
  out.push(`## 2. Rules of engagement`)
  out.push(``)
  out.push(
    [
      `- Work only in the components and source paths listed in section 3. Do not modify other components; if a change seems to need one, stop and report it.`,
      `- One use case (section 5) = one self-contained, reviewable change (branch / commit / PR). Finish it — code, tests, docs — before starting the next.`,
      `- Every management rule (RG-NN, section 6) becomes code AND at least one automated test whose name carries the rule id (e.g. \`test_RG_03_…\`).`,
      `- The acceptance criteria in section 8 are the test plan: implement each as an automated test and cite its id (AC-NN) in the test name.`,
      `- Never invent business values. Anything marked "to be provided by business", any undecided option and every item in section 9: STOP, ask a human, record the answer in this file, then continue.`,
      `- Reused components keep their current behaviour unless a requirement says otherwise. Where AS-IS → TO-BE is stated, implement TO-BE with the smallest diff that satisfies it.`,
      `- The non-functional constraints in section 7 are requirements, not suggestions.`,
      `- Keep the code, comments and commit messages free of anything that identifies real people or internal identifiers beyond what the codebase already uses.`,
      `- When done, complete the checklist in section 10 and list every deviation from this brief.`,
    ].join("\n")
  )
  out.push(``)

  // 3. Codebase map
  out.push(`## 3. Codebase map`)
  out.push(``)
  out.push(`| Component | Disposition | Type | Status | Source paths | Purpose |`)
  out.push(`|---|---|---|---|---|---|`)
  for (const m of solution.members || []) {
    const c = byId.get(m.component)
    const paths = (c?.source?.paths || []).map((p) => `\`${p}\``).join(", ")
    const repo = c?.source?.repo ? ` (repo: ${c.source.repo})` : ""
    const src = paths ? `${paths}${repo}` : m.disposition === "new" ? "new — create it" : "not mapped — locate by name before changing anything"
    const purpose = cell(c?.description?.oneliner || c?.description?.description || m.role || "")
    out.push(`| ${cell(c?.name || m.component)} (\`${m.component}\`) | ${m.disposition} | ${c?.type || "—"} | ${c?.status || "—"} | ${src} | ${purpose} |`)
  }
  const external: string[] = []
  const memberIds = new Set((solution.members || []).map((m) => m.component))
  for (const m of solution.members || []) {
    const c = byId.get(m.component)
    for (const l of c?.links || []) {
      if (l.target && !memberIds.has(l.target)) external.push(`- ${c?.name} → ${byId.get(l.target)?.name || l.target} (${l.role}${l.protocol ? `/${l.protocol}` : ""}) — outside this solution, do not modify`)
    }
  }
  if (external.length) {
    out.push(``)
    out.push(`External dependencies (read/call only):`)
    out.push(...Array.from(new Set(external)))
  }
  out.push(``)

  // 4. Scope
  out.push(`## 4. Scope`)
  out.push(``)
  out.push(scope || `In scope: the components listed in section 3 and the use cases in section 5. Anything not listed is out of scope.`)
  out.push(``)

  // 5. Work items
  out.push(`## 5. Work items — use cases`)
  out.push(``)
  if (seeds.ucs.length === 0) {
    out.push(`No process is modelled for this solution. Derive the work items from the FS chapter "Use Cases" and from the rules in section 6.`)
  }
  for (const u of seeds.ucs) {
    const rules = seeds.rgs.filter((g) => g.appliesIn.includes(u.id))
    const acRows = acceptance ? linesMentioning(acceptance, u.id) : []
    out.push(`### ${u.id} — ${u.process.name}`)
    out.push(``)
    if (u.process.goal) out.push(`**Goal:** ${u.process.goal}`)
    out.push(`**Actors / components:** ${u.participants.join(", ") || "—"}`)
    out.push(``)
    out.push(`**Flow to implement:**`)
    out.push(...(ucFlow(u).length ? ucFlow(u) : ["(no steps modelled — see the FS)"]))
    out.push(``)
    out.push(`**Rules to implement:** ${rules.length ? rules.map((g) => `${g.id} (${g.rule.name})`).join(", ") : "none captured"}`)
    out.push(``)
    out.push(`**Implementation notes:** ${n.ucNotes?.[u.id] || "(not generated — derive from the FS use case and the rules)"}`)
    out.push(``)
    out.push(`**Done when:**`)
    if (acRows.length) out.push(...acRows.map((r) => `- ${r.trim().replace(/^[-|]\s*/, "").replace(/\s*\|\s*$/, "").replace(/\s*\|\s*/g, " · ")}`))
    else out.push(`- the post-conditions of ${u.id} in the FS hold (write an automated test for each)`)
    out.push(``)
    out.push(`- [ ] implemented  - [ ] tests written and passing  - [ ] reviewed`)
    out.push(``)
  }
  const loose = seeds.rgs.filter((g) => g.appliesIn.length === 0)
  if (loose.length) {
    out.push(`### General rules (not tied to a use case)`)
    out.push(``)
    out.push(...loose.map((g) => `- ${g.id} — ${g.rule.name} (${g.componentName}): ${g.rule.summary || "see section 6"}`))
    out.push(``)
  }

  // 6. Rules register
  out.push(`## 6. Management rules — implementation register`)
  out.push(``)
  if (seeds.rgs.length === 0) out.push(`No management rules captured in the catalog. Take the rules from the FS chapter "Management Rules & Calculations".`)
  else {
    out.push(`| Id | Component | Kind | Statement | Formula / Given-When-Then | Status | Applies in | Test |`)
    out.push(`|---|---|---|---|---|---|---|---|`)
    for (const g of seeds.rgs) {
      const detail = ruleDetail(g.rule).replace(/^\s\[|\]$/g, "")
      out.push(
        `| ${g.id} | ${cell(g.componentName)} | ${g.rule.kind} | ${cell(g.rule.summary || g.rule.name)} | ${cell(detail) || "—"} | ${g.status}${g.asIs ? " (AS-IS → TO-BE)" : ""} | ${g.appliesIn.join(", ") || "—"} | \`test_${g.id.replace("-", "_")}\` |`
      )
    }
  }
  out.push(``)

  // 7. NFR
  out.push(`## 7. Non-functional constraints`)
  out.push(``)
  out.push(nfr || `No non-functional requirements captured — keep the current performance, security and audit behaviour of the reused components.`)
  out.push(``)

  // 8. Acceptance
  out.push(`## 8. Acceptance criteria (test plan)`)
  out.push(``)
  out.push(acceptance || `Derive one automated test per post-condition of each use case and per management rule.`)
  out.push(``)

  // 9. Open questions
  out.push(`## 9. Open questions — STOP and ask before implementing`)
  out.push(``)
  const qs = n.openQuestions || []
  if (qs.length) out.push(...qs.map((q, i) => `${i + 1}. [ ] ${q}`))
  if (openPoints) {
    out.push(``)
    out.push(`From the FS (assumptions, decisions, open points):`)
    out.push(``)
    out.push(openPoints)
  }
  if (!qs.length && !openPoints) out.push(`None recorded. If anything in the FS is ambiguous, add the question here and ask before implementing.`)
  out.push(``)

  // 10. DoD
  out.push(`## 10. Definition of done`)
  out.push(``)
  out.push(
    [
      `- [ ] Every use case in section 5 is implemented and its checklist is complete`,
      `- [ ] Every rule in section 6 has code and a named automated test`,
      `- [ ] Every acceptance criterion in section 8 is an automated test that passes`,
      `- [ ] Non-functional constraints in section 7 are met (state how you verified them)`,
      `- [ ] All questions in section 9 are answered and the answers recorded`,
      `- [ ] No changes outside the components in section 3`,
      `- [ ] Deviations from this brief are listed below`,
      ``,
      `Deviations: (none yet)`,
    ].join("\n")
  )
  out.push(``)

  // 11. Plan
  out.push(`## 11. Suggested order of work`)
  out.push(``)
  const plan = n.plan && n.plan.length ? n.plan : seeds.ucs.map((u) => `Implement ${u.id} — ${u.process.name}, with its rules and tests`)
  if (plan.length) out.push(...plan.map((p, i) => `${i + 1}. ${p}`))
  else out.push(`1. Read the FS. 2. Map the codebase (section 3). 3. Implement the rules (section 6) with tests. 4. Verify against section 8.`)
  out.push(``)

  // Appendix
  if (data || interfaces) {
    out.push(`## Appendix — data and interfaces (from the FS)`)
    out.push(``)
    if (data) {
      out.push(`### Data requirements`)
      out.push(``)
      out.push(data)
      out.push(``)
    }
    if (interfaces) {
      out.push(`### Interfaces, batches & notifications`)
      out.push(``)
      out.push(interfaces)
      out.push(``)
    }
  }

  return out.join("\n").trim() + "\n"
}
