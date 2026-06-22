// Pass 2 — rule extraction.
//
// Given the relevant passages from Pass 1 plus the rules already on the
// component, ask the LLM to emit structured rule candidates that match
// the ComponentRule schema. The output is shown in the import dialog
// for the analyst to review, edit and selectively import.

import type { Component, ComponentRule } from "@/lib/types"
import { getLLM } from "@/lib/llm"
import { getAgent, agentInstruction } from "@/lib/agents"
import type {
  RelevantSection,
  RuleCandidate,
  RuleCandidateKind,
} from "./types"

const PASS_2_MAX_TOKENS = 8192
// Cap on the concatenated passages we feed to Pass 2. Large enough for
// a generous set of relevant sections, small enough that Pass 2 stays
// under Anthropic's 200K context with the system instructions plus the
// component context plus existing rules.
const PASS_2_INPUT_CAP = 80_000
// Extraction runs in rounds: round 1 extracts what it can, each later
// round is a completeness sweep ("what did you miss?") fed the names
// already found, until a round adds nothing new or the caps are hit.
// This is what turns a 30-row table into ~30 rules instead of ~5 — one
// call abstracts and stops; the sweeps force it to enumerate the tail.
const MAX_ROUNDS = 5
const MAX_CANDIDATES = 250

function summariseExistingRules(rules: ComponentRule[] | undefined): string {
  if (!rules || rules.length === 0) return "(none)"
  return rules
    .map((r, i) => `  [${i}] (${r.kind}) ${r.name}${r.summary ? ` — ${r.summary}` : ""}`)
    .join("\n")
}

function buildComponentContextShort(c: Component): string {
  return [
    `Component: ${c.name} (${c.id}, ${c.type})`,
    `One-liner: ${c.description?.oneliner || "(none)"}`,
    `Capabilities: ${
      c.capabilities?.map((cp) => cp.name).filter(Boolean).slice(0, 12).join(", ") || "(none)"
    }`,
  ].join("\n")
}

export type ExtractSourceKind = "doc" | "code"

function summariseAlreadyFound(found: RuleCandidate[]): string {
  return found
    .map((c, i) => `  [${i}] (${c.kind}) ${c.name}${c.summary ? ` — ${c.summary}` : ""}`)
    .join("\n")
}

function buildPrompt(
  lead: string,
  component: Component,
  sections: RelevantSection[],
  sourceKind: ExtractSourceKind = "doc",
  language?: string,
  alreadyFound: RuleCandidate[] = []
): string {
  const sectionsText = sections
    .map(
      (s, i) =>
        `--- Section ${i + 1}: ${s.title} (confidence: ${s.confidence}) ---\n${s.excerpt}`
    )
    .join("\n\n")
  const capped =
    sectionsText.length > PASS_2_INPUT_CAP
      ? sectionsText.slice(0, PASS_2_INPUT_CAP) + "\n\n…(sections truncated)"
      : sectionsText

  const codeContext =
    sourceKind === "code"
      ? `\nThe passages below are SOURCE CODE${language && language !== "auto" ? ` (${language})` : ""}. Translate the code into business terms before emitting a candidate:
- If you find a numeric calculation, extract the formula as a plain algebraic expression — strip language syntax, keep the variable names from the code so the analyst can verify (e.g. \`total = base * (1 + rate)\`, NOT the language-specific assignment).
- If you find an if/else with business meaning, map it to Given (precondition) / When (trigger) / Then (outcome). Skip pure technical branches (null checks, retry loops).
- If you find a validator / guard / invariant, emit a constraint with a one-line summary describing what must always hold.
- Preserve the original variable / method names where useful so the analyst can audit against the source.
`
      : ""

  const sweep =
    alreadyFound.length > 0
      ? `\nYOU HAVE ALREADY EXTRACTED these rules in an earlier pass — do NOT repeat any of them:
${summariseAlreadyFound(alreadyFound)}

This is a COMPLETENESS SWEEP. Re-read the passages and extract every REMAINING distinct rule, row, case or calculation that is NOT already in the list above. If a table has rows you have not yet turned into rules, emit them now. Return {"candidates": []} only if nothing is left.
`
      : ""

  return `${lead}

You are extracting business rules from ${sourceKind === "code" ? "source code" : "documentation"} into a structured catalog. Your goal is MAXIMUM COMPLETENESS — capture every rule the source expresses, at fine granularity.

${buildComponentContextShort(component)}

The catalog already contains these rules on this component:
${summariseExistingRules(component.rules)}
${codeContext}
Below are passages relevant to this component. Extract every distinct rule, calculation, formula or constraint you find. Do not invent rules — only emit what the ${sourceKind === "code" ? "code" : "text"} states or directly implies.

GRANULARITY — aim for COMPLETENESS and fine detail, whatever the source is (prose spec, table, code, or a mix):
- Emit a separate rule for each distinct piece of logic the source states: each calculation/formula, each conditional (given/when/then), each constraint/invariant, each numbered or "must / shall" requirement, each threshold band, each named parameter or coefficient, each branch of an if/else, each case of a switch. Split these out rather than merging several into one broad rule.
- For TABULAR data (a header row + many rows): such a sheet is often a lookup / parameter / decision table where a row can encode its own rule (its key/condition columns map to a result/value column). Use judgement — extract per-row when rows carry genuinely distinct logic or values (capture the row's values so each rule is self-contained), and group rows only when they are truly identical in logic. Per-row is common but NOT mandatory: don't split a single rule across rows artificially, and don't collapse a rich table into just one or two rules either.
- Prefer several small, precise rules over a few broad ones — extracting only ~5 rules from a source with dozens of distinct cases is too shallow. But never invent: every rule must be supported by the source.
${sweep}
RULE KINDS:
- "formula"   — a calculation. Use \`formula\` for the expression (e.g. "total = base * (1 + rate)").
- "rule"      — a conditional logic. Use \`given\` (precondition), \`when\` (trigger), \`then\` (outcome).
- "constraint"— an invariant the component must respect. \`enforced_in\` is optional; only include when the source names specific component ids.

PER-CANDIDATE FIELDS:
- name        — concise, e.g. "Total calculation"
- kind        — one of: formula | rule | constraint
- summary     — one-line summary
- description — multi-line prose when useful, otherwise omit
- formula     — only when kind = formula
- given/when/then — only when kind = rule (omit any that is unknown)
- enforced_in — only when kind = constraint AND source names component ids
- confidence  — "high" | "medium" | "low"
- evidence    — short verbatim quote from the source (max 200 chars)
- source_section — which section number this came from (1-based)
- duplicate_of_index — index in the "existing rules" list above if this candidate looks like the same rule (otherwise omit or null)

Return ONLY this JSON object, no surrounding prose, no markdown fences:
{
  "candidates": [
    {
      "name": "...",
      "kind": "formula" | "rule" | "constraint",
      "summary": "...",
      "description": "...",
      "formula": "...",
      "given": "...",
      "when": "...",
      "then": "...",
      "enforced_in": "...",
      "confidence": "high" | "medium" | "low",
      "evidence": "...",
      "source_section": 1,
      "duplicate_of_index": null
    }
  ]
}

If you find no rules, return {"candidates": []}.

RELEVANT PASSAGES:
${capped}`
}

function extractJson(raw: string): unknown {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fence ? fence[1] : raw
  const first = candidate.indexOf("{")
  const last = candidate.lastIndexOf("}")
  if (first === -1 || last === -1 || last < first) return null
  try {
    return JSON.parse(candidate.slice(first, last + 1))
  } catch {
    return null
  }
}

function isValidKind(k: unknown): k is RuleCandidateKind {
  return k === "formula" || k === "rule" || k === "constraint"
}

function str(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, max)
}

// Parse one model response into validated candidates. Used by every round.
function parseCandidatesFromResponse(
  raw: string,
  existingCount: number
): RuleCandidate[] {
  const parsed = extractJson(raw)
  const out: RuleCandidate[] = []
  if (!parsed || typeof parsed !== "object" || !("candidates" in parsed)) return out
  const arr = (parsed as { candidates?: unknown[] }).candidates
  if (!Array.isArray(arr)) return out
  for (const item of arr) {
    if (!item || typeof item !== "object") continue
    const it = item as Record<string, unknown>
    const name = str(it.name, 200)
    const kind = it.kind
    if (!name || !isValidKind(kind)) continue
    const conf =
      it.confidence === "high" || it.confidence === "medium" || it.confidence === "low"
        ? it.confidence
        : "medium"
    const dupIdxRaw = it.duplicate_of_index
    let duplicate_of_index: number | null = null
    if (typeof dupIdxRaw === "number" && Number.isInteger(dupIdxRaw)) {
      if (dupIdxRaw >= 0 && dupIdxRaw < existingCount) {
        duplicate_of_index = dupIdxRaw
      }
    }
    const sourceSection = str(it.source_section, 120) || undefined
    out.push({
      name,
      kind,
      summary: str(it.summary, 400),
      description: str(it.description, 4000),
      formula: kind === "formula" ? str(it.formula, 2000) : undefined,
      given: kind === "rule" ? str(it.given, 600) : undefined,
      when: kind === "rule" ? str(it.when, 600) : undefined,
      then: kind === "rule" ? str(it.then, 600) : undefined,
      enforced_in: kind === "constraint" ? str(it.enforced_in, 600) : undefined,
      confidence: conf,
      evidence: str(it.evidence, 240),
      sourceSection,
      duplicate_of_index,
    })
  }
  return out
}

// Identity for de-duping a candidate across rounds. Name alone is too
// coarse for a decision table (rows can share a name), so fold in the
// discriminating fields too.
function candidateKey(c: RuleCandidate): string {
  return [c.name, c.formula, c.given, c.when, c.then]
    .map((s) => (s || "").trim().toLowerCase().replace(/\s+/g, " "))
    .join("¦")
}

export interface ExtractResult {
  candidates: RuleCandidate[]
  ms: number
  rounds: number
}

export async function extractRuleCandidates(
  component: Component,
  sections: RelevantSection[],
  sourceKind: ExtractSourceKind = "doc",
  language?: string
): Promise<ExtractResult> {
  const t0 = Date.now()
  const llm = await getLLM()
  const lead = agentInstruction(await getAgent("rules-extractor"))
  const existingCount = component.rules?.length ?? 0

  const collected: RuleCandidate[] = []
  const seen = new Set<string>()
  let rounds = 0
  for (let round = 0; round < MAX_ROUNDS; round++) {
    rounds++
    const prompt = buildPrompt(lead, component, sections, sourceKind, language, collected)
    const raw = await llm.complete({ prompt, maxTokens: PASS_2_MAX_TOKENS })
    const fresh = parseCandidatesFromResponse(raw, existingCount)
    let added = 0
    for (const c of fresh) {
      const key = candidateKey(c)
      if (seen.has(key)) continue
      seen.add(key)
      collected.push(c)
      added++
      if (collected.length >= MAX_CANDIDATES) break
    }
    // Stop when a sweep adds nothing new, or we hit the cap.
    if (added === 0 || collected.length >= MAX_CANDIDATES) break
  }

  return { candidates: collected, ms: Date.now() - t0, rounds }
}
