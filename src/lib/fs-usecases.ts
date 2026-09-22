// FS use-case machinery: stable UC / RG seeds and the chunked, partly
// deterministic generation of the "Use Cases" chapter.
//
// A Functional Specification is organised around USE CASES (one per
// modelled process) and numbered MANAGEMENT RULES (one per catalog rule of
// the members). Like the DSD's FR/NFR seeds, the ids are derived from a
// stable ordering of the catalog so the same solution yields the same
// UC-NN / RG-NN on every regeneration — keeping cross-references, the
// acceptance criteria and per-section feedback anchored.
//
// The chapter itself is produced in bounded chunks (a single writer call
// truncates long lists): the LLM writes each use case's table, rules table
// and UI note; the process flow (steps + sequence diagram) is rendered
// deterministically from the modelled sequence and spliced in, so every
// process is guaranteed to appear.

import type { Component, ComponentRule, Solution, SolutionProcess } from "./types"
import { buildSolutionSequenceMermaid } from "./solution-sequence"

export interface UcSeed {
  id: string
  process: SolutionProcess
  /** Display labels of the participants (member and external actors). */
  participants: string[]
  /** Catalog ids of the member components taking part. */
  memberComponentIds: string[]
}

export interface RgSeed {
  id: string
  componentId: string
  componentName: string
  rule: ComponentRule
  status: string
  asIs: boolean
  /** UC ids whose process involves the owning component. */
  appliesIn: string[]
}

export interface FsSeeds {
  ucs: UcSeed[]
  rgs: RgSeed[]
}

const pad = (n: number) => String(n).padStart(2, "0")

function statusFor(status: string | undefined, disposition: string): string {
  if (disposition === "new") return "To be implemented"
  if (status === "draft" || status === "proposed") return "To be implemented"
  return "Implemented"
}

/** Stable UC / RG seeds for a solution. */
export function fsSeeds(solution: Solution, components: Component[]): FsSeeds {
  const byId = new Map(components.map((c) => [c.id, c]))
  const members = solution.members || []
  const processes = solution.processes || []

  // Use cases keep the analyst's process order (it is the intended reading
  // order of the specification).
  const ucs: UcSeed[] = processes.map((p, i) => {
    const memberIds = Array.from(
      new Set((p.actors || []).filter((a) => a.kind === "member" && a.component).map((a) => a.component as string))
    )
    return {
      id: `UC-${pad(i + 1)}`,
      process: p,
      participants: (p.actors || []).map((a) => a.label || (a.component ? byId.get(a.component)?.name || a.component : a.id)),
      memberComponentIds: memberIds,
    }
  })

  // Rules: members by component id, rules by name — the same ordering the
  // DSD uses for FR seeds.
  const sortedMembers = [...members].sort((a, b) => a.component.localeCompare(b.component))
  const rgs: RgSeed[] = []
  let n = 0
  for (const m of sortedMembers) {
    const c = byId.get(m.component)
    const rules = [...(c?.rules || [])].sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    for (const r of rules) {
      n += 1
      rgs.push({
        id: `RG-${pad(n)}`,
        componentId: m.component,
        componentName: c?.name || m.component,
        rule: r,
        status: statusFor(c?.status, m.disposition),
        asIs: m.disposition === "extend",
        appliesIn: ucs.filter((u) => u.memberComponentIds.includes(m.component)).map((u) => u.id),
      })
    }
  }
  return { ucs, rgs }
}

const clip = (s: string | undefined, max = 220): string => {
  const t = (s || "").replace(/\s+/g, " ").trim()
  return t.length > max ? t.slice(0, max) + "…" : t
}

/** One-line detail of a rule (formula / given-when-then) for the facts. */
export function ruleDetail(r: ComponentRule): string {
  const parts: string[] = []
  if (r.formula) parts.push(`formula: ${clip(r.formula)}`)
  if (r.given || r.when || r.then) {
    parts.push(
      [r.given ? `given: ${clip(r.given)}` : "", r.when ? `when: ${clip(r.when)}` : "", r.then ? `then: ${clip(r.then)}` : ""]
        .filter(Boolean)
        .join("; ")
    )
  }
  return parts.length ? ` [${parts.join(" | ")}]` : ""
}

/** The two FS seed blocks appended to the verified facts. */
export function renderFsSeedFacts(seeds: FsSeeds): string[] {
  const lines: string[] = []
  if (seeds.ucs.length) {
    lines.push(`## Use case seeds — assign these EXACT ids (UC-NN) and keep them stable across regenerations`)
    for (const u of seeds.ucs) {
      lines.push(
        `- ${u.id} ← Process "${u.process.name}"${u.process.goal ? ` — ${u.process.goal}` : ""}${
          u.participants.length ? ` [participants: ${u.participants.join(", ")}]` : ""
        }`
      )
    }
    lines.push(
      `Use cases you derive from the source document (features with no modelled process) take the next free numbers (UC-${pad(seeds.ucs.length + 1)}, …).`
    )
    lines.push("")
  }
  if (seeds.rgs.length) {
    lines.push(`## Management rule seeds — assign these EXACT ids (RG-NN) and keep them stable across regenerations`)
    for (const g of seeds.rgs) {
      lines.push(
        `- ${g.id} ← [${g.componentName}] ${g.rule.name} (${g.rule.kind})${g.rule.summary ? ` — ${g.rule.summary}` : ""}${ruleDetail(
          g.rule
        )} [status: ${g.status}]${g.asIs ? " [has AS-IS behaviour — describe AS-IS vs TO-BE]" : ""} [applies in: ${
          g.appliesIn.length ? g.appliesIn.join(", ") : "no modelled use case"
        }]`
      )
    }
    lines.push(
      `Rules you derive from the source document take the next free numbers (RG-${pad(seeds.rgs.length + 1)}, …) and cite the passage.`
    )
    lines.push("")
  }
  return lines
}

// ------------------------- deterministic rendering -------------------------

/** The process flow block of one use case: sequence diagram + numbered steps. */
export function renderUcFlow(p: SolutionProcess): string {
  const actorLabel = (aid: string) => {
    const a = (p.actors || []).find((x) => x.id === aid)
    return a ? a.label || a.component || a.id : aid
  }
  const out: string[] = ["**Process flow**"]
  if ((p.actors || []).length && (p.steps || []).length) {
    out.push("```mermaid\n" + buildSolutionSequenceMermaid(p) + "\n```")
  }
  const steps = (p.steps || []).map((s, i) => {
    const kind = s.kind || "sync"
    return !s.to || kind === "note"
      ? `${i + 1}. **${actorLabel(s.from)}** — ${s.label}${s.description ? `: ${s.description}` : ""}`
      : `${i + 1}. **${actorLabel(s.from)} → ${actorLabel(s.to)}** _(${kind})_ — ${s.label}${s.description ? `: ${s.description}` : ""}`
  })
  out.push(steps.length ? steps.join("\n") : "No steps modelled for this process yet.")
  return out.join("\n\n")
}

/** Minimal, fully deterministic use case — used when the writer dropped one. */
function renderUcFallback(u: UcSeed, rgs: RgSeed[]): string {
  const p = u.process
  const principal =
    (p.actors || []).find((a) => a.kind === "external")?.label || u.participants[0] || "to be confirmed by business"
  const rules = rgs.filter((g) => g.appliesIn.includes(u.id))
  const rows = [
    `| Use case ID | ${u.id} |`,
    `| Name | ${p.name} |`,
    `| Principal actor | ${principal} |`,
    `| Components involved | ${u.participants.join(", ") || "—"} |`,
    `| Description | ${p.goal || `Process "${p.name}" as modelled in the solution.`} |`,
    `| Trigger | ${p.steps?.[0]?.label || "to be confirmed by business"} |`,
    `| Pre-conditions | 1. The participating systems are available and the actor is authorised. |`,
    `| Post-conditions | 1. ${p.steps?.length ? p.steps[p.steps.length - 1].label : "The process completes as modelled."} |`,
    `| Status | To be confirmed |`,
  ]
  const rulesTable = rules.length
    ? [
        "| N° | Rule | Source |",
        "|---|---|---|",
        ...rules.map((g) => `| ${g.id} | ${g.rule.summary || g.rule.name} | ${g.componentName} |`),
      ].join("\n")
    : "No management rules captured for this use case."
  return [
    `### ${u.id} — ${p.name}`,
    "| Field | Value |\n|---|---|\n" + rows.join("\n"),
    "**Management rules**",
    rulesTable,
    "**User interface & messages**",
    "No screen change specified.",
  ].join("\n\n")
}

/** Rules that no modelled use case covers, as a table (or ""). */
export function renderGeneralRules(rgs: RgSeed[]): string {
  const loose = rgs.filter((g) => g.appliesIn.length === 0)
  if (!loose.length) return ""
  const table = [
    "| N° | Rule | Kind | Component |",
    "|---|---|---|---|",
    ...loose.map((g) => `| ${g.id} | ${g.rule.summary || g.rule.name} | ${g.rule.kind} | ${g.componentName} |`),
  ].join("\n")
  return [
    "### General management rules",
    "Rules of member components that no modelled use case exercises. Their full statements are in chapter 6.",
    table,
  ].join("\n\n")
}

// ------------------------------ generation ------------------------------

const UC_CHUNK = 3 // use cases written per LLM call

function ucChunkPrompt(instruction: string, facts: string, chunk: UcSeed[], rgs: RgSeed[]): string {
  const seedLines = chunk.map(
    (u) =>
      `- ${u.id} ← Process "${u.process.name}"${u.process.goal ? ` — ${u.process.goal}` : ""} [participants: ${
        u.participants.join(", ") || "none modelled"
      }]`
  )
  const rgLines = rgs.map(
    (g) =>
      `- ${g.id} ← [${g.componentName}] ${g.rule.name} (${g.rule.kind})${g.rule.summary ? ` — ${g.rule.summary}` : ""} [applies in: ${
        g.appliesIn.length ? g.appliesIn.join(", ") : "none"
      }]`
  )
  return `${instruction}

Write the Use Cases for ONLY the use-case seeds listed below — EVERY one of them, in order. Do NOT write the chapter title, any other chapter, or the process flow (it is inserted automatically from the modelled sequence); output ONLY the use-case sub-sections.

For EACH seed produce:
- a sub-heading "### UC-NN — <use case name>" using the seed's EXACT id and the process name;
- the use-case table as a two-column table "| Field | Value |" with one row per field: Use case ID | Name | Principal actor | Components involved | Description | Trigger | Pre-conditions (numbered 1., 2., …) | Post-conditions (numbered) | Status — every cell filled from the facts; never "(empty)" or "TBD" — where the facts give nothing for a field, derive it from the process steps and add "to be confirmed by business";
- a "**Management rules**" table with columns N° | Rule | Source — one row per RG id from the MANAGEMENT RULE SEEDS whose "applies in" lists this use case, in RG order, each stated in ONE testable sentence (the full statement, formula and worked example live in chapter 6 — do not restate them differently here); write "No management rules captured for this use case." when there are none;
- a "**User interface & messages**" block. It has a FIXED structure of up to three sub-parts, each a heading line in italics followed by ONE table, and each present ONLY when the facts or the source document specify such content: "*Screens*" → table Screen | Change; "*Fields*" → table Field | Type | Mandatory | Default | Allowed values | Editable by; "*Labels & messages*" → table Key | Text | Shown when. Never write prose inside this block and never invent screens, fields or texts. When nothing is specified for the whole block, write exactly the single line "No screen change specified." under the heading.
Cross-reference other use cases and rules only by their ids (UC-NN, RG-NN). Never invent actors, systems, fields, values or thresholds.

USE-CASE SEEDS TO WRITE (all ${chunk.length}):
${seedLines.join("\n")}

MANAGEMENT RULE SEEDS (use these exact ids in the rules tables):
${rgLines.length ? rgLines.join("\n") : "(none captured)"}

VERIFIED FACTS (ground every use case strictly in these; the source document, if attached, is included here):
${facts}

Output only the Markdown for the use cases above.`
}

/** Split a writer's output into blocks keyed by the UC id of their heading. */
function splitByUc(markdown: string): Map<string, string> {
  const map = new Map<string, string>()
  const re = /^###\s+(UC-\d+)\b[^\n]*$/gm
  const heads: { id: string; start: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown))) heads.push({ id: m[1], start: m.index })
  heads.forEach((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].start : markdown.length
    if (!map.has(h.id)) map.set(h.id, markdown.slice(h.start, end).trim())
  })
  return map
}

/** Insert the deterministic flow after the use-case table (before the rules). */
function spliceFlow(block: string, flow: string): string {
  const marker = block.indexOf("**Management rules**")
  if (marker >= 0) return `${block.slice(0, marker).trimEnd()}\n\n${flow}\n\n${block.slice(marker)}`
  return `${block.trimEnd()}\n\n${flow}`
}

/**
 * Generate the whole "Use Cases" chapter body. Returns "" when no process is
 * modelled (the section writer then derives use cases from the guidance).
 */
export async function generateUseCasesChapter(
  solution: Solution,
  components: Component[],
  facts: string,
  instruction: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  llm: any
): Promise<string> {
  const seeds = fsSeeds(solution, components)
  if (seeds.ucs.length === 0) return ""
  const written = new Map<string, string>()
  for (let i = 0; i < seeds.ucs.length; i += UC_CHUNK) {
    const chunk = seeds.ucs.slice(i, i + UC_CHUNK)
    const body: string = (
      await llm.complete({ prompt: ucChunkPrompt(instruction, facts, chunk, seeds.rgs), maxTokens: 4000 })
    ).trim()
    for (const [id, block] of splitByUc(body)) written.set(id, block)
  }
  const parts = seeds.ucs.map((u) => {
    const block = written.get(u.id) || renderUcFallback(u, seeds.rgs)
    return spliceFlow(block, renderUcFlow(u.process))
  })
  const general = renderGeneralRules(seeds.rgs)
  if (general) parts.push(general)
  // Lead with a non-heading sentence so the locked-chapter assembler keeps
  // the first "### UC-01" heading intact.
  return (
    "The use cases below are derived from the modelled processes and the management rules of the components that take part in them; their ids are stable across regenerations.\n\n" +
    parts.join("\n\n")
  )
}
