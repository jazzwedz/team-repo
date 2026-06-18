// Two-pass rules-import pipeline.
//
// Pass 1 (identify): given a document and the component context, produce
// a list of passages relevant to THIS component's logic. This filter step
// is what makes the pipeline practical on 50+ page documents — the
// extractor only sees what matters.
//
// Pass 2 (extract): given the filtered passages plus the existing rules,
// produce structured rule candidates that the analyst can review and
// import.

export interface RelevantSection {
  title: string
  excerpt: string
  whyRelevant: string
  confidence: "high" | "medium" | "low"
}

export type RuleCandidateKind = "formula" | "rule" | "constraint"

export interface RuleCandidate {
  name: string
  kind: RuleCandidateKind
  summary?: string
  description?: string
  // For kind === "formula"
  formula?: string
  // For kind === "rule"
  given?: string
  when?: string
  then?: string
  // For kind === "constraint" — optional, comma-separated component ids
  // when present in source; otherwise omitted.
  enforced_in?: string
  // Metadata for the review UI
  confidence: "high" | "medium" | "low"
  evidence?: string
  sourceSection?: string
  // Index in the existing rules array (passed to Pass 2) when the
  // candidate looks like a duplicate. Null when distinct.
  duplicate_of_index?: number | null
}

export interface RulesImportMeta {
  docName: string
  docChars: number
  pass1Skipped: boolean
  relevantSectionsCount: number
  candidatesCount: number
  pass1Ms?: number
  pass2Ms: number
  totalMs: number
}

export interface RulesImportResult {
  ok: true
  candidates: RuleCandidate[]
  meta: RulesImportMeta
}

export interface RulesImportError {
  ok: false
  error:
    | "token-cap-exceeded"
    | "extract-failed"
    | "ai-failed"
    | "no-relevant-sections"
    | "no-candidates"
    | "llm-not-configured"
  message: string
  docChars?: number
  maxChars?: number
}
