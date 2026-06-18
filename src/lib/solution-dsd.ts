// DSD (Detailed Solution Description) generation as a small in-process
// orchestration: deterministic grounding → draft → critic → revise loop.
//
// The solution + its members are structured data, so we compute the
// "verified facts" (inventory, capability/process mapping, dependencies,
// NFR rollup, flows, diagram) in code and hand them to the model as
// ground truth. The model writes prose around them; a critic pass checks
// the draft against those facts and a bounded revise loop fixes issues.
//
// Runs as a fire-and-forget job (the app is a single long-running node
// server) so the multi-call flow survives gateway request timeouts; the
// client polls for phase + result. Reuses the existing LLM client, so it
// goes through the same corp gateway as everything else.

import { randomUUID } from "crypto"
import { getLLM } from "./llm"
import { buildSolutionMermaid } from "./architecture-mermaid"
import type { Component, Solution } from "./types"
import { getLogger } from "./log"
import { saveDsd, newArtifactId, listDsd, type DsdMode, type DsdSection } from "./dsd-store"
import { getAgent, agentInstruction } from "./agents"
import { getSourceGit, isSourceCodeConfigured } from "./source-git"
import { codeSearch } from "./code-search"
import { buildSolutionSequenceMermaid } from "./solution-sequence"
import { getDataModel, isDataModelConfigured } from "./data-model"
import {
  WRITER_GROUPS,
  CRITIC_LENSES,
  LEAD_AGENT_ID,
  ALL_CHAPTERS,
  type WriterGroup,
  type CriticLens,
  type DsdChapter,
} from "./dsd-sections"

// ----------------------------- job store -----------------------------

export type DsdPhase = "grounding" | "drafting" | "reviewing" | "revising" | "consolidating" | "saving" | "done" | "error"

export interface DsdJob {
  status: "running" | "done" | "error"
  phase: DsdPhase
  /** Set when the run finished and the artifact was persisted. */
  artifactId?: string
  markdown?: string
  error?: string
  iterations?: number
  updatedAt: number
}

const jobs = new Map<string, DsdJob>()
const JOB_TTL_MS = 30 * 60 * 1000

function prune() {
  const now = Date.now()
  for (const [id, j] of jobs) if (now - j.updatedAt > JOB_TTL_MS) jobs.delete(id)
}

export function getDsdJob(id: string): DsdJob | undefined {
  return jobs.get(id)
}

export interface DsdOptions {
  /** Writing depth — adjusts guidance + token budget. */
  depth?: "concise" | "standard" | "detailed"
  /** Audience framing/tone. */
  audience?: "technical" | "management" | "mixed"
  /** Output language. */
  language?: "en" | "sk"
  /** Chapter ids to include; empty/undefined = all. Team mode only. */
  includeChapters?: string[]
  /** Optional source requirements document (BRD/spec) the analyst attached,
   *  already extracted to plain text. Fed to the writers as grounding for
   *  purpose, references, traceability and functional-requirement depth. */
  sourceDoc?: { name: string; text: string }
}

// How much of the source document to feed into the prompt. Bounds the
// prompt size; the writers get the most relevant leading portion.
const SOURCE_DOC_CAP = 16000

// A clearly-fenced grounding block appended to the verified facts. The BRD
// informs behaviour/requirements/references; it must NOT be used to invent
// architecture components or members (those come from the catalog facts).
function sourceContextBlock(doc: { name: string; text: string }): string {
  const text = doc.text.trim()
  const capped =
    text.length > SOURCE_DOC_CAP ? text.slice(0, SOURCE_DOC_CAP) + "\n\n…(source document truncated)" : text
  return [
    ``,
    `## SOURCE REQUIREMENTS DOCUMENT — "${doc.name}" (provided by the analyst)`,
    `This is the source requirement document (e.g. a BRD) this solution implements. Use it to:`,
    `- name the reference documentation in the Document Purpose chapter,`,
    `- derive the Functional Requirements and the Traceability Matrix (trace each FR to a section of this document where possible),`,
    `- add behaviour, inputs, steps and data detail the catalog alone does not capture.`,
    `Do NOT introduce architecture components, flows or members that are not in the verified facts above — the catalog defines the inventory; this document informs behaviour and requirements.`,
    ``,
    `"""`,
    capped,
    `"""`,
  ].join("\n")
}

export function startDsdJob(
  solution: Solution,
  components: Component[],
  mode: DsdMode = "quick",
  /** Per-chapter analyst-provided text (chapter id → text). Locked: used
   *  verbatim, the writers skip it and never change it. Team mode only. */
  provided: Record<string, string> = {},
  options: DsdOptions = {}
): string {
  prune()
  const id = randomUUID()
  jobs.set(id, { status: "running", phase: "grounding", updatedAt: Date.now() })
  // Detached — keeps running after the POST response returns.
  runDsd(id, solution, components, mode, provided, options).catch((e) => {
    getLogger().error("DSD job crashed", { id, err: e instanceof Error ? e.message : String(e) })
    jobs.set(id, {
      status: "error",
      phase: "error",
      error: e instanceof Error ? e.message : String(e),
      updatedAt: Date.now(),
    })
  })
  return id
}

function setPhase(id: string, phase: DsdPhase, extra?: Partial<DsdJob>) {
  const cur = jobs.get(id)
  jobs.set(id, { ...cur, ...extra, status: "running", phase, updatedAt: Date.now() })
}

interface DsdResult {
  markdown: string
  iterations: number
  sections?: DsdSection[]
  agentVersions?: Record<string, number>
  lockedChapters?: string[]
}

async function runDsd(
  id: string,
  solution: Solution,
  components: Component[],
  mode: DsdMode,
  provided: Record<string, string> = {},
  options: DsdOptions = {}
): Promise<void> {
  let facts = buildGroundedFacts(solution, components)
  // Append the attached source requirements (BRD) as additional grounding.
  if (options.sourceDoc?.text?.trim()) {
    facts += "\n" + sourceContextBlock(options.sourceDoc)
  }
  // Append real source-code snippets for members that map to code in the
  // connected source repo (read-only). Best-effort: never block generation.
  if (isSourceCodeConfigured()) {
    try {
      const evidence = await gatherSourceEvidence(solution, components)
      if (evidence) facts += "\n" + evidence
    } catch (e) {
      getLogger().warn("DSD source-code grounding failed (continuing without it)", {
        err: e instanceof Error ? e.message : String(e),
      })
    }
    // Cross-member interactions observed in the actual code (via Code
    // Search) — grounds Solution Architecture / Dependencies / Runtime with
    // what the code really does. Best-effort; never blocks generation.
    try {
      const interactions = await gatherCodeInteractions(solution, components)
      if (interactions) facts += "\n" + interactions
    } catch (e) {
      getLogger().warn("DSD code-interactions grounding failed (continuing without it)", {
        err: e instanceof Error ? e.message : String(e),
      })
    }
  }
  // Append authoritative column specs from the data-model registry for any
  // table-type members that link an entity. Best-effort; never blocks.
  if (isDataModelConfigured()) {
    try {
      const dm = await gatherDataModelEvidence(solution, components)
      if (dm) facts += "\n" + dm
    } catch (e) {
      getLogger().warn("DSD data-model grounding failed (continuing without it)", {
        err: e instanceof Error ? e.message : String(e),
      })
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const llm: any = await getLLM()

  const directives = buildDirectives(options)
  const result = mode === "team"
    ? await runTeamDsd(id, solution, facts, llm, provided, options, directives)
    : await runQuickDsd(id, solution, facts, llm, directives)

  // Persist the artifact to the DSD library (best-effort: even if the
  // save fails the markdown is still returned so the user sees it).
  setPhase(id, "saving", { iterations: result.iterations })
  const artifactId = newArtifactId()
  // Default title: "<solution> v<N>" by generation count. The analyst can
  // rename it afterwards.
  const priorCount = await listDsd(solution.id).then((a) => a.length).catch(() => 0)
  const defaultTitle = `${solution.name} v${priorCount + 1}`
  try {
    await saveDsd(
      {
        id: artifactId,
        solutionId: solution.id,
        title: defaultTitle,
        mode,
        model: llm.model,
        createdAt: new Date().toISOString(),
        ...(options.sourceDoc?.name ? { sourceDocName: options.sourceDoc.name } : {}),
        ...(result.agentVersions ? { agentVersions: result.agentVersions } : {}),
        // Persist only id+title — the section text already lives in the
        // markdown body; storing bodies here would duplicate the whole doc.
        ...(result.sections ? { sections: result.sections.map((s) => ({ id: s.id, title: s.title })) } : {}),
        ...(result.lockedChapters && result.lockedChapters.length ? { lockedChapters: result.lockedChapters } : {}),
        iterations: result.iterations,
        feedback: [],
      },
      result.markdown
    )
    jobs.set(id, {
      status: "done",
      phase: "done",
      markdown: result.markdown,
      iterations: result.iterations,
      artifactId,
      updatedAt: Date.now(),
    })
  } catch (e) {
    getLogger().error("Failed to persist DSD artifact", {
      id,
      err: e instanceof Error ? e.message : String(e),
    })
    jobs.set(id, { status: "done", phase: "done", markdown: result.markdown, iterations: result.iterations, updatedAt: Date.now() })
  }
  getLogger().info("DSD job done", { id, mode, iterations: result.iterations })
}

const LANG_LABEL: Record<string, string> = { en: "English", sk: "Slovak" }

// A short style directive appended to the writer instructions, from the
// pre-generation setup (depth / audience / language).
function buildDirectives(o: DsdOptions): string {
  const parts: string[] = []
  if (o.depth === "concise") parts.push("Keep it concise — short and dense, only what matters.")
  else if (o.depth === "detailed") parts.push("Be thorough and detailed; expand wherever the facts support it.")
  if (o.audience === "management") parts.push("Write for management: lead with outcomes and business value, minimise jargon.")
  else if (o.audience === "technical") parts.push("Write for engineers: precise and technical, assume domain knowledge.")
  if (o.language && o.language !== "en")
    parts.push(`Write the document in ${LANG_LABEL[o.language] || o.language} (keep established technical terms in English).`)
  return parts.join(" ")
}

// ----- quick mode: single writer → critic → revise (built-in prompts) -----
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runQuickDsd(id: string, solution: Solution, facts: string, llm: any, directives: string): Promise<DsdResult> {
  setPhase(id, "drafting")
  let draft: string = await llm.complete({ prompt: draftPrompt(solution, facts, undefined, directives), maxTokens: 4096 })
  let iterations = 0
  for (let i = 0; i < 2; i++) {
    setPhase(id, "reviewing", { iterations })
    const review = await llm.complete({ prompt: criticPrompt(facts, draft), maxTokens: 1500 })
    const verdict = parseVerdict(review)
    if (verdict.ok || verdict.issues.length === 0) break
    iterations++
    setPhase(id, "revising", { iterations })
    draft = await llm.complete({ prompt: revisePrompt(facts, draft, verdict.issues, undefined, directives), maxTokens: 4096 })
  }
  return { markdown: draft, iterations }
}

// ----- team mode: specialised section writers (parallel) → critic panel
// (parallel) → targeted per-section revise → lead consolidation -----
async function runTeamDsd(
  id: string,
  solution: Solution,
  facts: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  llm: any,
  provided: Record<string, string>,
  options: DsdOptions,
  directives: string
): Promise<DsdResult> {
  const [writers, critics, lead] = await Promise.all([
    Promise.all(WRITER_GROUPS.map((g) => getAgent(g.agentId))),
    Promise.all(CRITIC_LENSES.map((c) => getAgent(c.agentId))),
    getAgent(LEAD_AGENT_ID),
  ])
  const agentVersions: Record<string, number> = {}
  for (const a of [...writers, ...critics, lead]) agentVersions[a.id] = a.version

  const exemplars = await gatherExemplars(solution.id)

  // Append the setup directives (depth / audience / language) to each
  // writer's persona, and the lead's.
  const inst = (a: { system_prompt: string; lessons?: string }) => {
    const base = agentInstruction(a as never)
    return directives ? `${base}\n\n${directives}` : base
  }

  // Chapter inclusion (Advanced). Empty/undefined = all chapters.
  const includeSet =
    options.includeChapters && options.includeChapters.length ? new Set(options.includeChapters) : null
  const isIncluded = (cid: string) => !includeSet || includeSet.has(cid)
  const includedTitles = ALL_CHAPTERS.filter((c) => isIncluded(c.id)).map((c) => c.title)

  // Guarantee the Runtime Process Flow from the modelled process sequences:
  // render it deterministically and lock it so the overloaded functional
  // writer can't drop it. Respect an analyst-provided runtime chapter.
  if (!(provided["runtime-flow"] && provided["runtime-flow"].trim())) {
    const rf = renderRuntimeProcessFlow(solution)
    if (rf) provided["runtime-flow"] = rf
  }

  // Locked chapters (analyst-provided, used verbatim, never written/changed).
  // Only chapters that are also included count.
  const lockedIds = new Set(Object.keys(provided).filter((k) => provided[k] && provided[k].trim() && isIncluded(k)))
  const hasLocks = lockedIds.size > 0
  const lockedTitles = ALL_CHAPTERS.filter((c) => lockedIds.has(c.id)).map((c) => c.title)
  // ALL locked chapters across the document — given to every writer as
  // context so the whole document stays consistent with what the analyst
  // fixed, not just within the same group. Capped to keep prompts bounded.
  const LOCKED_CTX_CAP = 8000
  const globalLockedRaw = ALL_CHAPTERS.filter((c) => lockedIds.has(c.id))
    .map((c) => `## ${c.title}\n${provided[c.id].trim()}`)
    .join("\n\n")
  const globalLockedContext =
    globalLockedRaw.length > LOCKED_CTX_CAP
      ? globalLockedRaw.slice(0, LOCKED_CTX_CAP) + "\n\n…(locked content truncated)"
      : globalLockedRaw

  // 1. Draft each group's UNLOCKED chapters in parallel; splice locked verbatim.
  setPhase(id, "drafting")
  const sections: DsdSection[] = await Promise.all(
    WRITER_GROUPS.map(async (g, i) => {
      const groupChapters = g.chapters.filter((c) => isIncluded(c.id))
      if (groupChapters.length === 0) return { id: g.agentId, title: g.name, body: "" }
      const unlocked = groupChapters.filter((c) => !lockedIds.has(c.id))
      let writerOut = ""
      if (unlocked.length > 0) {
        writerOut = (
          await llm.complete({
            prompt: sectionWriterPrompt(g, facts, inst(writers[i]), exemplars.get(g.agentId), unlocked, globalLockedContext),
            maxTokens: 2200,
          })
        ).trim()
      }
      return { id: g.agentId, title: g.name, body: assembleGroupBody(provided, lockedIds, writerOut, groupChapters) }
    })
  )

  // 2. Critic panel reviews the assembled draft (parallel); locked chapters
  //    are off-limits.
  setPhase(id, "reviewing")
  const assembled1 = sections.map((s) => s.body || "").join("\n\n")
  const verdicts = await Promise.all(
    CRITIC_LENSES.map((c, i) =>
      llm
        .complete({ prompt: criticLensPrompt(c, facts, assembled1, agentInstruction(critics[i]), lockedTitles), maxTokens: 1200 })
        .then((r: string) => parseVerdict(r))
        .catch(() => ({ ok: true, issues: [] as { section: string; problem: string }[] }))
    )
  )
  const issuesByGroup = new Map<string, { section: string; problem: string }[]>()
  for (const v of verdicts) {
    for (const iss of v.issues) {
      const gid = mapIssueToGroup(iss.section)
      if (!gid) continue
      const arr = issuesByGroup.get(gid) || []
      arr.push(iss)
      issuesByGroup.set(gid, arr)
    }
  }

  // 3. Revise only the groups with issues — rewriting their UNLOCKED chapters.
  let iterations = 0
  if (issuesByGroup.size > 0) {
    iterations = 1
    setPhase(id, "revising", { iterations })
    await Promise.all(
      WRITER_GROUPS.map(async (g, i) => {
        const issues = issuesByGroup.get(g.agentId)
        if (!issues || issues.length === 0) return
        const groupChapters = g.chapters.filter((c) => isIncluded(c.id))
        const unlocked = groupChapters.filter((c) => !lockedIds.has(c.id))
        if (unlocked.length === 0) return // nothing writable in this group
        const sec = sections.find((s) => s.id === g.agentId)
        if (!sec) return
        const writerOut: string = (
          await llm.complete({
            prompt: reviseSectionPrompt(g, facts, sec.body || "", issues, inst(writers[i]), unlocked, globalLockedContext),
            maxTokens: 2200,
          })
        ).trim()
        sec.body = assembleGroupBody(provided, lockedIds, writerOut, groupChapters)
      })
    )
  }

  // 4. Deterministic assembly. Lead polish runs only when nothing is locked,
  //    so locked chapters are guaranteed verbatim.
  setPhase(id, "consolidating", { iterations })
  const assembled = assembleDoc(solution, sections, includedTitles)
  let markdown = assembled
  if (!hasLocks) {
    try {
      const polished: string = (
        await llm.complete({ prompt: leadPrompt(inst(lead), assembled), maxTokens: 8192 })
      ).trim()
      if (isPolishSafe(polished, assembled, includedTitles)) markdown = polished
    } catch {
      // keep the deterministic assembly
    }
  }

  return { markdown, sections, iterations, agentVersions, lockedChapters: Array.from(lockedIds) }
}

// Build a writer group's body: locked chapters verbatim (from `provided`),
// unlocked chapters parsed out of the writer's output, all in chapter order.
function assembleGroupBody(
  provided: Record<string, string>,
  lockedIds: Set<string>,
  writerOut: string,
  chapters: DsdChapter[]
): string {
  const blocks = writerOut ? splitChapters(writerOut) : new Map<string, string>()
  const unlockedCount = chapters.filter((c) => !lockedIds.has(c.id)).length
  const parts = chapters.map((c) => {
    if (lockedIds.has(c.id)) return ensureHeading(c.title, provided[c.id])
    const block = blocks.get(normTitle(c.title))
    if (block) return block
    // Fallback: single unlocked chapter whose heading the model dropped.
    if (unlockedCount === 1 && writerOut) return ensureHeading(c.title, writerOut)
    return `## ${c.title}\n\n_(not generated)_`
  })
  return parts.join("\n\n")
}

function normTitle(t: string): string {
  return t.trim().toLowerCase().replace(/^\d+\.\s*/, "").replace(/\s+/g, " ")
}

function splitChapters(md: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const part of md.split(/\n(?=#{2,3}\s)/)) {
    const m = part.match(/^#{2,3}\s+(.+)/)
    if (m) map.set(normTitle(m[1]), part.trim().replace(/^#{3}\s/, "## "))
  }
  return map
}

function ensureHeading(title: string, text: string): string {
  const body = (text || "").trim().replace(/^#{1,6}\s+.*(?:\r?\n)+/, "")
  return `## ${title}\n\n${body}`
}

// Deterministically render the Runtime Process Flow chapter body from the
// solution's modelled process sequences (the same data that powers the
// sequence diagram). Injected as a locked chapter so the runtime section
// always reflects `processes` and can't be silently dropped by a writer.
// Returns "" when no sequences are modelled (writer then falls back to the
// flows or "No runtime flow modelled yet.").
export function renderRuntimeProcessFlow(solution: Solution): string {
  const processes = solution.processes || []
  if (!processes.length) return ""
  const out: string[] = []
  for (const p of processes) {
    const actorLabel = (aid: string) => {
      const a = p.actors.find((x) => x.id === aid)
      return a ? a.label || a.component || a.id : aid
    }
    out.push(`### ${p.name}`)
    if (p.goal) out.push(p.goal)
    // The sequence diagram (same render as the Processes view); the DSD
    // viewer + PDF export render fenced ```mermaid blocks.
    if ((p.actors || []).length && (p.steps || []).length) {
      out.push("```mermaid\n" + buildSolutionSequenceMermaid(p) + "\n```")
    }
    const steps = p.steps.map((s, i) => {
      const kind = s.kind || "sync"
      return !s.to || kind === "note"
        ? `${i + 1}. **${actorLabel(s.from)}** — ${s.label}${s.description ? `: ${s.description}` : ""}`
        : `${i + 1}. **${actorLabel(s.from)} → ${actorLabel(s.to)}** _(${kind})_ — ${s.label}${s.description ? `: ${s.description}` : ""}`
    })
    if (steps.length) out.push(steps.join("\n"))
  }
  return out.join("\n\n").trim()
}

// Most recent analyst correction per section group, used as a golden
// few-shot exemplar so writers match the depth/style the analyst wants.
async function gatherExemplars(solutionId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const arts = await listDsd(solutionId) // newest first, includes feedback
    for (const a of arts) {
      for (const f of a.feedback || []) {
        if (f.section && f.correctedText && !map.has(f.section)) map.set(f.section, f.correctedText)
      }
    }
  } catch {
    // no exemplars — fine
  }
  return map
}

// Resolve a critic's issue tag to a writer group id (it may return the
// group id directly, or a chapter title).
function mapIssueToGroup(section: string | undefined): string | undefined {
  if (!section) return undefined
  const s = section.trim().toLowerCase()
  const byId = WRITER_GROUPS.find((g) => g.agentId.toLowerCase() === s)
  if (byId) return byId.agentId
  const byChapter = WRITER_GROUPS.find((g) =>
    g.chapters.some((c) => s.includes(c.title.toLowerCase()) || c.title.toLowerCase().includes(s))
  )
  return byChapter?.agentId
}

function assembleDoc(solution: Solution, sections: DsdSection[], includedTitles: string[]): string {
  const toc = ["1. Document History", ...includedTitles].map((t) => `- ${t}`).join("\n")
  const ordered = WRITER_GROUPS.map((g) => sections.find((s) => s.id === g.agentId)?.body || "").filter(Boolean)
  return [
    `# ${solution.name} — Detailed Solution Description`,
    ``,
    `## Table of Contents`,
    toc,
    ``,
    `## 1. Document History`,
    `| Version | Date | Changes applied | Author(s) | Contributor(s) |`,
    `|---------|------|-----------------|-----------|----------------|`,
    `| 1.0 | ${new Date().toISOString().slice(0, 10)} | Initial version | Analyst (Team Repository) | AI agent team |`,
    ``,
    ordered.join("\n\n"),
  ].join("\n")
}

// Guard against a lead pass that truncated or dropped content: keep the
// polish only if it is long enough and still contains every chapter.
function isPolishSafe(polished: string, assembled: string, includedTitles: string[]): boolean {
  if (polished.length < assembled.length * 0.8) return false
  return includedTitles.every((t) => polished.includes(t))
}

// --------------------------- grounded facts ---------------------------

const DC_ORDER = ["public", "internal", "confidential", "restricted"]

export function buildGroundedFacts(solution: Solution, components: Component[]): string {
  const byId = new Map(components.map((c) => [c.id, c]))
  const members = solution.members || []
  const memberIds = new Set(members.map((m) => m.component))
  const label = (cid: string) => byId.get(cid)?.name || cid

  const lines: string[] = []
  lines.push(`# VERIFIED FACTS — use these exactly; do NOT invent components, flows or values not listed here.`)
  lines.push("")
  lines.push(`## Solution`)
  lines.push(`- Name: ${solution.name}`)
  lines.push(`- Status: ${solution.status}`)
  if (solution.owner) lines.push(`- Owner: ${solution.owner}`)
  if (solution.goal) lines.push(`- Goal: ${solution.goal}`)
  if (solution.description?.description)
    lines.push(`- Description: ${solution.description.description}`)
  lines.push("")

  // Inventory
  lines.push(`## Members (component inventory) — the ONLY components in this solution`)
  lines.push(`| Component | Type | Disposition | Role in solution | Status | Owner |`)
  lines.push(`|---|---|---|---|---|---|`)
  for (const m of members) {
    const c = byId.get(m.component)
    lines.push(
      `| ${label(m.component)} | ${c?.type || "?"} | ${m.disposition} | ${m.role || "-"} | ${c?.status || "?"} | ${c?.owner || "-"} |`
    )
  }
  lines.push("")

  // Capability mapping + gaps
  const caps = solution.delivers?.capabilities || []
  if (caps.length) {
    lines.push(`## Capability mapping`)
    const findCovering = (name: string) => {
      const hits: string[] = []
      for (const m of members) {
        const c = byId.get(m.component)
        if (!c) {
          // new component not in catalog snapshot — count it as a provider
          if (m.disposition === "new") hits.push(`${m.component} (new)`)
          continue
        }
        if ((c.capabilities || []).some((x) => x.name?.toLowerCase() === name.toLowerCase()))
          hits.push(`${c.name}${m.disposition === "new" ? " (new)" : ""}`)
        else if (m.disposition === "new") hits.push(`${c.name} (new)`)
      }
      return hits
    }
    for (const cap of caps) {
      const hits = findCovering(cap)
      lines.push(`- Capability "${cap}" → ${hits.length ? hits.join(", ") : "GAP — no member provides it (needs a new component)"}`)
    }
    lines.push("")
  }

  // Flows
  const flows = solution.flows || []
  if (flows.length) {
    lines.push(`## Flows`)
    for (const f of flows) {
      lines.push(`- ${label(f.from)} → ${label(f.to)} — ${f.role}${f.protocol ? `/${f.protocol}` : ""} (${f.status})`)
    }
    lines.push("")
  }

  // Process sequences — ordered, actor→target steps.
  const processes = solution.processes || []
  if (processes.length) {
    lines.push(`## Process sequences`)
    for (const p of processes) {
      const actorLabel = (id: string) => {
        const a = p.actors.find((x) => x.id === id)
        if (!a) return id
        return a.label || (a.component ? label(a.component) : a.id)
      }
      lines.push(`### ${p.name}`)
      if (p.goal) lines.push(`- Goal: ${p.goal}`)
      if (p.actors.length) {
        const parts = p.actors
          .map((a) => `${a.label}${a.role ? ` (${a.role})` : ""}`)
          .join(", ")
        lines.push(`- Participants: ${parts}`)
      }
      p.steps.forEach((s, i) => {
        const kind = s.kind || "sync"
        if (!s.to || kind === "note") {
          lines.push(`${i + 1}. [${actorLabel(s.from)}] ${s.label}${s.description ? ` — ${s.description}` : ""}`)
        } else {
          lines.push(
            `${i + 1}. ${actorLabel(s.from)} → ${actorLabel(s.to)} (${kind}): ${s.label}${s.description ? ` — ${s.description}` : ""}`
          )
        }
      })
      lines.push("")
    }
  }

  // Dependencies (member links pointing outside the solution)
  const deps: string[] = []
  for (const m of members) {
    const c = byId.get(m.component)
    for (const l of c?.links || []) {
      if (l.target && !memberIds.has(l.target)) {
        deps.push(`- ${c?.name} → ${label(l.target)} (${l.role}${l.protocol ? `/${l.protocol}` : ""}) — external to this solution`)
      }
    }
  }
  if (deps.length) {
    lines.push(`## External dependencies`)
    lines.push(...deps)
    lines.push("")
  }

  // NFR rollup
  const nfrLines: string[] = []
  if (solution.nfr && Object.keys(solution.nfr).length)
    nfrLines.push(`- Solution targets: ${JSON.stringify(solution.nfr)}`)
  let maxDc = -1
  for (const m of members) {
    const c = byId.get(m.component)
    if (c?.nfr) nfrLines.push(`- ${c.name}: ${JSON.stringify(c.nfr)}`)
    const dc = c?.nfr?.data_classification
    if (dc) maxDc = Math.max(maxDc, DC_ORDER.indexOf(dc))
  }
  if (maxDc >= 0) nfrLines.push(`- Highest data classification across members: ${DC_ORDER[maxDc]}`)
  if (nfrLines.length) {
    lines.push(`## Non-functional requirements`)
    lines.push(...nfrLines)
    lines.push("")
  }

  // Risks
  const risks: string[] = [...(solution.risks || [])]
  for (const m of members) {
    const c = byId.get(m.component)
    for (const r of c?.risks || []) risks.push(`${c?.name}: ${r}`)
  }
  if (risks.length) {
    lines.push(`## Risks`)
    for (const r of risks) lines.push(`- ${r}`)
    lines.push("")
  }

  // Business rules
  const ruleLines: string[] = []
  for (const m of members) {
    const c = byId.get(m.component)
    for (const r of c?.rules || []) {
      ruleLines.push(`- [${c?.name}] ${r.name} (${r.kind})${r.summary ? ` — ${r.summary}` : ""}`)
    }
  }
  if (ruleLines.length) {
    lines.push(`## Business rules (from members)`)
    lines.push(...ruleLines)
    lines.push("")
  }

  // ---- Stable requirement seeds (deterministic FR/NFR ids + status) ----
  // Numbering is derived from a stable ordering of the catalog (members by
  // id, rules by name, then processes) so the SAME catalog yields the SAME
  // FR/NFR ids on every regeneration — keeping traceability and per-section
  // feedback anchored. Requirements the writer derives from the BRD/code
  // take the next free numbers.
  const statusFor = (status: string | undefined, disposition: string): string => {
    if (disposition === "new") return "To be implemented"
    if (status === "draft" || status === "proposed") return "To be implemented"
    return "Implemented"
  }
  const pad = (n: number) => String(n).padStart(2, "0")
  const sortedMembers = [...members].sort((a, b) => a.component.localeCompare(b.component))
  const frSeeds: string[] = []
  let frN = 0
  for (const m of sortedMembers) {
    const c = byId.get(m.component)
    const rs = [...(c?.rules || [])].sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    for (const r of rs) {
      frN += 1
      const asIs = m.disposition === "extend" ? " [has AS-IS behaviour — describe AS-IS vs TO-BE]" : ""
      frSeeds.push(
        `- FR-${pad(frN)} ← [${c?.name || m.component}] ${r.name} (${r.kind})${r.summary ? ` — ${r.summary}` : ""} [status: ${statusFor(c?.status, m.disposition)}]${asIs}`
      )
    }
  }
  for (const p of processes) {
    frN += 1
    frSeeds.push(`- FR-${pad(frN)} ← Process "${p.name}"${p.goal ? ` — ${p.goal}` : ""}`)
  }
  if (frSeeds.length) {
    lines.push(`## Functional requirement seeds — assign these EXACT ids (FR-NN) and keep them stable across regenerations`)
    lines.push(...frSeeds)
    lines.push(
      `Requirements you derive from the source BRD or source code take the next free numbers (FR-${pad(frN + 1)}, …). For formula/calculation rules, include a short worked example as an input → output table.`
    )
    lines.push("")
  }

  const nfrSeeds: string[] = []
  let nfrN = 0
  const NFR_FIELDS: { key: keyof NonNullable<Solution["nfr"]>; label: string }[] = [
    { key: "availability", label: "Availability target" },
    { key: "rto", label: "Recovery time objective (RTO)" },
    { key: "rpo", label: "Recovery point objective (RPO)" },
    { key: "max_latency", label: "Max latency" },
    { key: "throughput", label: "Throughput" },
  ]
  for (const f of NFR_FIELDS) {
    const v = solution.nfr?.[f.key]
    if (v) {
      nfrN += 1
      nfrSeeds.push(`- NFR-${pad(nfrN)} ← ${f.label}: ${v}`)
    }
  }
  if (maxDc >= 0) {
    nfrN += 1
    nfrSeeds.push(`- NFR-${pad(nfrN)} ← Data classification: ${DC_ORDER[maxDc]} (security & data protection)`)
  }
  if (nfrSeeds.length) {
    lines.push(`## Non-functional requirement seeds — assign these EXACT ids (NFR-NN) and keep them stable`)
    lines.push(...nfrSeeds)
    lines.push("")
  }

  // Diagram
  lines.push(`## Architecture diagram (use this mermaid block verbatim in the architecture section)`)
  lines.push("```mermaid")
  lines.push(buildSolutionMermaid(members, components, flows))
  lines.push("```")

  return lines.join("\n")
}

// --------------------- source-code grounding (ADO) --------------------

// Caps so the injected code can't blow the prompt budget.
const SRC_FILE_CAP = 4000
const SRC_TOTAL_CAP = 16000
const SRC_MAX_FILES = 8

// Read the files mapped on each member's `source.paths` from the connected
// (read-only) source repo and format them as an authoritative evidence
// block. Bounded by file/total/count caps; missing files are skipped.
async function gatherSourceEvidence(solution: Solution, components: Component[]): Promise<string> {
  const byId = new Map(components.map((c) => [c.id, c]))
  const members = solution.members || []
  const git = getSourceGit()
  const blocks: string[] = []
  let total = 0
  let files = 0
  for (const m of members) {
    if (files >= SRC_MAX_FILES || total >= SRC_TOTAL_CAP) break
    const c = byId.get(m.component)
    const paths = c?.source?.paths || []
    for (const p of paths) {
      if (files >= SRC_MAX_FILES || total >= SRC_TOTAL_CAP) break
      try {
        const f = await git.getFile(p)
        let content = (f.content || "").trim()
        if (!content) continue
        if (content.length > SRC_FILE_CAP) content = content.slice(0, SRC_FILE_CAP) + "\n…(file truncated)"
        total += content.length
        files += 1
        blocks.push(`### ${c?.name || m.component} — \`${p}\`\n\`\`\`\n${content}\n\`\`\``)
      } catch {
        // missing / unreadable file — skip it
      }
    }
  }
  if (!blocks.length) return ""
  return [
    ``,
    `## SOURCE CODE EVIDENCE (read from the connected source repository — authoritative for behaviour)`,
    `These are real source files for the solution's components. Use them as authoritative evidence for the Functional Requirements (behaviour, inputs, steps, constraints), Data Structures and embedded logic — you may quote short excerpts. Do NOT introduce architecture components or members beyond the verified facts; the catalog defines the inventory.`,
    ...blocks,
  ].join("\n\n")
}

// ---------------- code-observed interactions (Code Search) ----------------
//
// Solution-scoped, grounding-only: use the members' already-mapped source
// (source.paths) + ADO Code Search to surface which members actually
// reference each other in code. Feeds Solution Architecture / Dependencies
// / Runtime with what the code really does (and lets the writer flag where
// it diverges from the modelled flows). Does NOT re-run the per-component
// scanner; it only reads source.paths the analyst already mapped.

const CI_MAX_MEMBERS = 12 // members we run a Code Search query for
const CI_MAX_EDGES = 30

async function gatherCodeInteractions(
  solution: Solution,
  components: Component[]
): Promise<string> {
  const byId = new Map(components.map((c) => [c.id, c]))
  // Members that have mapped source — they can be the OWNER of a hit file.
  const owners = (solution.members || [])
    .map((m) => byId.get(m.component))
    .filter((c): c is Component => !!c && !!(c.source?.paths && c.source.paths.length))
  if (owners.length < 2) return "" // need at least two mapped members to relate

  // path / folder → owning member, for attributing search hits.
  const folderOwner: { prefix: string; id: string; name: string }[] = []
  const allFolders = new Set<string>()
  for (const c of owners) {
    for (const p of c.source!.paths!) {
      folderOwner.push({ prefix: p, id: c.id, name: c.name }) // exact file
      const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ""
      const folder = "/" + dir.replace(/^\//, "")
      folderOwner.push({ prefix: dir, id: c.id, name: c.name })
      allFolders.add(folder)
    }
  }
  const ownerOf = (hitPath: string): { id: string; name: string } | undefined => {
    // Prefer the most specific (longest) matching prefix.
    let best: { prefix: string; id: string; name: string } | undefined
    for (const o of folderOwner) {
      if ((hitPath === o.prefix || hitPath.startsWith(o.prefix + "/")) && (!best || o.prefix.length > best.prefix.length)) {
        best = o
      }
    }
    return best ? { id: best.id, name: best.name } : undefined
  }

  const paths = Array.from(allFolders)
  const edges = new Map<string, { from: string; to: string; file: string }>()
  for (const target of owners.slice(0, CI_MAX_MEMBERS)) {
    if (edges.size >= CI_MAX_EDGES) break
    const term = target.name.trim()
    if (!term) continue
    let res
    try {
      res = await codeSearch(term, { top: 20, paths })
    } catch {
      // Code Search unavailable — skip the whole block (best-effort).
      return ""
    }
    if (!res.ok) continue
    for (const hit of res.hits) {
      const owner = ownerOf(hit.path)
      if (!owner || owner.id === target.id) continue // self-reference / unowned
      const key = `${owner.id}->${target.id}`
      if (!edges.has(key)) edges.set(key, { from: owner.name, to: target.name, file: hit.path })
      if (edges.size >= CI_MAX_EDGES) break
    }
  }
  if (edges.size === 0) return ""

  const lines = Array.from(edges.values()).map(
    (e) => `- ${e.from} → ${e.to} (referenced in \`${e.file}\`)`
  )
  return [
    ``,
    `## CODE-OBSERVED INTERACTIONS (from the source repository)`,
    `These cross-member references were found in the actual code. Use them to ground the Solution Architecture and Dependencies, and the Runtime Process Flow. Where a code-observed interaction is NOT reflected in the modelled flows above (or vice-versa), call it out plainly. Do not invent members beyond the catalog inventory.`,
    ...lines,
  ].join("\n")
}

// ------------------- data-model grounding (registry) ------------------

const DM_MAX_ENTITIES = 12
const DM_MAX_ATTRS = 80

// For table-type members that link a registry entity, fetch the entity's
// attributes (and relationships) and format them as authoritative column
// specifications for the Data Structures chapter. Bounded; best-effort.
async function gatherDataModelEvidence(solution: Solution, components: Component[]): Promise<string> {
  const byId = new Map(components.map((c) => [c.id, c]))
  const members = solution.members || []
  const dm = getDataModel()
  const blocks: string[] = []
  let n = 0
  for (const m of members) {
    if (n >= DM_MAX_ENTITIES) break
    const c = byId.get(m.component)
    const entity = c?.data_model?.entity
    if (!entity) continue
    try {
      const ev = await dm.getEntity(entity)
      if (!ev || !ev.attributes?.length) continue
      n += 1
      const attrs = ev.attributes.slice(0, DM_MAX_ATTRS)
      const rows = attrs
        .map((a) => `| ${a.name} | ${a.type} | ${a.nullable ? "yes" : "no"} |`)
        .join("\n")
      const more =
        ev.attributes.length > attrs.length
          ? `\n…(${ev.attributes.length - attrs.length} more attributes)`
          : ""
      let rel = ""
      try {
        const rels = await dm.getRelationships(entity)
        if (rels?.length) {
          rel =
            `\nRelationships: ` +
            rels
              .slice(0, 20)
              .map((r) => `${r.parent} → ${r.child}${r.type ? ` (${r.type})` : ""}`)
              .join("; ")
        }
      } catch {
        // relationships are optional
      }
      blocks.push(
        `### ${c?.name || m.component} — entity \`${entity}\`${ev.version ? ` (version ${ev.version})` : ""}\n` +
          `| Field | Type | Nullable |\n|---|---|---|\n${rows}${more}${rel}`
      )
    } catch {
      // entity not found / registry error — skip this one
    }
  }
  if (!blocks.length) return ""
  return [
    ``,
    `## DATA MODEL (from the registry — authoritative column specifications)`,
    `Use these as the authoritative column specifications for the Data Structures chapter (the registry is the source of truth). Do not invent fields.`,
    ...blocks,
  ].join("\n\n")
}

// ------------------------------ prompts -------------------------------

const STYLE = `Write like a knowledgeable colleague — clear, direct, no fluff. Short sentences. No marketing words (leverage, robust, seamless, synergy, holistic, empower, streamline). State facts plainly.`

function draftPrompt(solution: Solution, facts: string, instruction?: string, directives?: string): string {
  const base =
    instruction ||
    `You are a solution architect writing a Detailed Solution Description (DSD) in Markdown. ${STYLE}`
  const lead = directives ? `${base}\n\n${directives}` : base
  return `${lead}

Base the document STRICTLY on the verified facts below. Do not introduce components, flows, capabilities or values that are not in the facts. Where you reason beyond the data (e.g. sequencing the roadmap), say so plainly.

${facts}

Produce the DSD with these chapters, in order:

# ${solution.name} — Detailed Solution Description

## Table of Contents
(numbered list of the chapters below)

## 1. Document History
| Version | Date | Changes applied | Author(s) | Contributor(s) |
|---------|------|-----------------|-----------|----------------|
| 1.0 | [today's date] | Initial version | Analyst (Team Repository) | AI agent |

## 2. Document Purpose
Who it is for (developers, testers, reviewers/audit), what the system does and does not do, and a short note on the source requirements and data model it aligns to (or "to be linked").

## 3. Solution Context
Upstream (what feeds it), Downstream (what consumes it), and Responsibility Boundaries (what it is and is NOT responsible for) — from the members, flows and dependencies.

## 4. Scope
In scope: the member components. Out of scope: anything not listed.

## 5. Solution Architecture
The component inventory table (from the facts) and 2-3 sentences on how the pieces fit. Then include the architecture mermaid block from the facts verbatim.

## 6. Capability Mapping
The mapping from the facts. Call out any GAP that needs a new component.

## 7. Requirements & Traceability Matrix
A table: FR id | Satisfies (capability/process/BRD section) | Status. Use the EXACT FR ids and statuses from the requirement seeds in the facts.

## 8. Functional Requirements
Use the FR seeds in the facts (exact FR-NN ids, kept stable). One-line statement + behaviour/steps/constraints + the given status. Describe AS-IS vs TO-BE where a seed is flagged. For formula/calculation rules add a short input → output worked example. Do not invent beyond the facts.

## 9. Runtime Process Flow
The end-to-end flow as numbered steps from the process sequences and flows (or "No runtime flow modelled yet.").

## 10. Data Structures
Column tables (Field | Type | Description | Example) for data entities the facts support (or note schema will be added once the data model/source is linked).

## 11. Non-Functional Requirements
NFRs by category. Use the EXACT NFR-NN ids from the requirement seeds in the facts, plus the NFR targets and highest data classification.

## 12. Business Rules
The business rules from the facts (or "none captured yet").

## 13. Risks & Assumptions
The risks from the facts plus any explicit assumptions you make.

## 14. Implementation Roadmap
Group the work by disposition: reuse as-is, extend, new to build. Note readiness (which members are still draft).

## 15. Appendix & References
Referenced documents, data models and external specs from the facts (or "No external references linked yet.").

Output only the Markdown document.`
}

function criticPrompt(facts: string, draft: string, instruction?: string): string {
  const lead =
    instruction ||
    `You are reviewing a Detailed Solution Description draft against the verified facts it must be based on. Find ONLY real problems.`
  return `${lead}

Flag an issue when the draft:
- mentions a component, flow, capability or value that is NOT in the facts (invention),
- contradicts the facts,
- omits a required chapter (1-11),
- states an NFR / risk / rule that the facts do not support.

VERIFIED FACTS:
${facts}

DRAFT:
${draft}

Return ONLY JSON, no prose:
{ "ok": boolean, "issues": [ { "section": "chapter or topic", "problem": "what is wrong and how to fix" } ] }
"ok" is true when there are no real problems. Be strict about inventions, lenient about style.`
}

function revisePrompt(
  facts: string,
  draft: string,
  issues: { section: string; problem: string }[],
  instruction?: string,
  directives?: string
): string {
  const issueList = issues.map((i, n) => `${n + 1}. [${i.section}] ${i.problem}`).join("\n")
  const lead = [instruction, directives].filter(Boolean).join("\n\n")
  const leadBlock = lead ? `${lead}\n\n` : ""
  return `${leadBlock}Revise the Detailed Solution Description below to fix the listed issues. Keep everything that is correct; change only what the issues require. Stay strictly within the verified facts. ${STYLE}

VERIFIED FACTS:
${facts}

ISSUES TO FIX:
${issueList}

CURRENT DRAFT:
${draft}

Output only the full corrected Markdown document.`
}

// ----- team-mode prompts -----

function sectionWriterPrompt(
  group: WriterGroup,
  facts: string,
  instruction: string,
  exemplar: string | undefined,
  chaptersToWrite: DsdChapter[],
  lockedContext: string
): string {
  const chapters = chaptersToWrite.map((c) => `## ${c.title}\n${c.guidance}`).join("\n\n")
  const ex = exemplar
    ? `\nAn analyst-approved example of the depth and style they want for this part — match it, but use THIS solution's facts (do not copy its content):\n"""\n${exemplar}\n"""\n`
    : ""
  const locked = lockedContext
    ? `\nThese chapters are PROVIDED BY THE ANALYST and are FIXED across the document — do NOT write or repeat any of them, but keep your chapters fully consistent with them (terminology, decisions, numbers):\n"""\n${lockedContext}\n"""\n`
    : ""
  return `${instruction}

Write ONLY your assigned chapters of a Detailed Solution Description, grounded STRICTLY in the verified facts. Output each chapter with its exact "## N. Title" heading, in order, and nothing else — no document title, no other chapters.

YOUR CHAPTERS:
${chapters}
${locked}${ex}
VERIFIED FACTS:
${facts}

Output only the Markdown for your chapters.`
}

function criticLensPrompt(lens: CriticLens, facts: string, draft: string, instruction: string, lockedTitles: string[] = []): string {
  const groups = WRITER_GROUPS.map((g) => `- ${g.agentId}: ${g.chapters.map((c) => c.title).join("; ")}`).join("\n")
  const locked = lockedTitles.length
    ? `\nThese chapters are analyst-provided and FIXED — do NOT flag them, they will not be changed: ${lockedTitles.join("; ")}.\n`
    : ""
  return `${instruction}

Review the DSD draft below through your lens only. For each real problem, return an issue tagged with the writer GROUP id that owns the affected chapter.

WRITER GROUPS (use the id as "section"):
${groups}
${locked}
VERIFIED FACTS:
${facts}

DRAFT:
${draft}

Return ONLY JSON, no prose:
{ "ok": boolean, "issues": [ { "section": "<group id>", "problem": "what is wrong and how to fix" } ] }
"ok" is true when there are no problems in your lens.`
}

function reviseSectionPrompt(
  group: WriterGroup,
  facts: string,
  body: string,
  issues: { section: string; problem: string }[],
  instruction: string,
  chaptersToWrite: DsdChapter[],
  lockedContext: string
): string {
  const issueList = issues.map((i, n) => `${n + 1}. ${i.problem}`).join("\n")
  const chapters = chaptersToWrite.map((c) => c.title).join(", ")
  const locked = lockedContext
    ? `\nThese chapters are FIXED across the document (analyst-provided) — do NOT output or change them, just keep your chapters consistent with them:\n"""\n${lockedContext}\n"""\n`
    : ""
  return `${instruction}

Revise ONLY these chapters to fix the listed issues: ${chapters}. Keep everything correct; change only what the issues require. Stay strictly within the verified facts. Output each chapter with its exact "## N. Title" heading and nothing else. ${STYLE}
${locked}
ISSUES TO FIX:
${issueList}

VERIFIED FACTS:
${facts}

THE CURRENT DRAFT OF YOUR SECTION (for reference):
${body}

Output only the corrected Markdown for the chapters listed above.`
}

function leadPrompt(instruction: string, assembled: string): string {
  return `${instruction}

Polish the assembled DSD below into one coherent document: improve flow, transitions and terminology consistency, and remove duplication ACROSS sections. Do NOT add or remove facts, chapters or the architecture diagram, and keep every chapter with its exact "## N. Title" heading. Return the FULL document.

DOCUMENT:
${assembled}

Output only the full polished Markdown document.`
}

interface Verdict {
  ok: boolean
  issues: { section: string; problem: string }[]
}

function parseVerdict(text: string): Verdict {
  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    const body = fenced ? fenced[1] : text
    const start = body.indexOf("{")
    const end = body.lastIndexOf("}")
    if (start < 0 || end < 0) return { ok: true, issues: [] }
    const parsed = JSON.parse(body.slice(start, end + 1)) as Partial<Verdict>
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues
          .filter((i) => i && typeof i === "object")
          .map((i) => ({ section: String(i.section || ""), problem: String(i.problem || "") }))
          .filter((i) => i.problem)
      : []
    return { ok: parsed.ok === true || issues.length === 0, issues }
  } catch {
    // If the critic didn't return parseable JSON, don't block — accept draft.
    return { ok: true, issues: [] }
  }
}
