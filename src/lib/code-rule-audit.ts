// Code-aware rule audit — populate the `implemented` facet of a
// component's rules from its actual source code.
//
// For a component that maps source files (`source.paths`), read those
// files from the connected read-only source repo and ask the
// code-rule-auditor agent, for each EXISTING rule, to find where it is
// implemented, derive a structured `implemented` facet from the code, and
// judge how it relates to the documented (requested) rule. Rules found in
// the code but absent from the catalog are surfaced as implemented-only.
//
// Grounding (anti-hallucination): the model returns a verbatim code
// snippet; we locate that snippet in the actual file to compute the real
// line range and build a deep link — anything we can't locate is dropped,
// so the citation can't be invented. Read-only throughout; nothing is
// written to the source repo, and catalog writes happen only after the
// analyst approves.

import { getSourceGit, isSourceCodeConfigured } from "./source-git"
import { RULE_KINDS } from "./constants"
import type { Component, ComponentRule, Reconciliation, CodeEvidence } from "./types"

// Caps so injected code can't blow the prompt budget (mirror DSD grounding).
const FILE_CAP = 6000
const TOTAL_CAP = 24000
const MAX_FILES = 10

const RECONCILIATIONS: Reconciliation[] = [
  "requested-only",
  "implemented-only",
  "consistent",
  "divergent",
]

export interface RuleAuditProposal {
  /** "existing" updates a catalog rule's implemented facet; "new" is an implemented-only rule. */
  target: "existing" | "new"
  /** Existing rule name (must match) or proposed new rule name. */
  name: string
  /** For new rules — the rule kind derived from code. */
  kind?: string
  reconciliation: Reconciliation
  implemented?: {
    summary?: string
    formula?: string
    given?: string
    when?: string
    then?: string
    evidence?: CodeEvidence
  }
  /** One-line explanation, especially for divergent. */
  note?: string
}

export function isRuleAuditAvailable(component: Component): boolean {
  return isSourceCodeConfigured() && !!(component.source?.paths && component.source.paths.length > 0)
}

interface SourceFile {
  path: string
  content: string
}

/** Read the component's mapped source files (bounded, best-effort). */
export async function readComponentSource(component: Component): Promise<SourceFile[]> {
  const git = getSourceGit()
  const out: SourceFile[] = []
  let total = 0
  for (const p of component.source?.paths || []) {
    if (out.length >= MAX_FILES || total >= TOTAL_CAP) break
    try {
      const f = await git.getFile(p)
      let content = (f.content || "").trim()
      if (!content) continue
      if (content.length > FILE_CAP) content = content.slice(0, FILE_CAP) + "\n…(truncated)"
      total += content.length
      out.push({ path: p, content })
    } catch {
      // missing / unreadable — skip
    }
  }
  return out
}

// ----------------------------- prompt -----------------------------

function ruleLine(r: ComponentRule): string {
  const bits = [r.formula, [r.given, r.when, r.then].filter(Boolean).join(" / "), r.summary]
    .filter((x) => x && x.trim())
    .join(" — ")
  return `- "${r.name}" (${r.kind})${bits ? `: ${bits}` : ""}`
}

export function buildRuleAuditPrompt(
  instruction: string,
  component: Component,
  files: SourceFile[]
): string {
  const rules = (component.rules || []).map(ruleLine).join("\n") || "(none documented)"
  const code = files.map((f) => `### FILE: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join("\n\n")

  return `${instruction}

Component "${component.name}" [id: ${component.id}]. Below are its documented (requested) business rules and its actual source code. For EACH documented rule, find where it is implemented in the code and report:
- whether the code implements it and how (a structured "implemented" version: summary and, if applicable, formula or given/when/then derived FROM THE CODE);
- a "snippet": the exact lines from the code that implement it, copied VERBATIM (so it can be located);
- "reconciliation": "consistent" (code matches the documented rule), "divergent" (code does something different — explain in note), or "requested-only" (you could not find it implemented in the provided code).
Also list any business rule clearly present in the code but NOT in the documented list, as "implemented-only" new rules.

Never invent. Only cite code that appears in the files below; copy the snippet verbatim. If unsure, prefer "requested-only" over guessing.

DOCUMENTED RULES:
${rules}

SOURCE CODE:
${code}

Return ONLY JSON, no prose:
{ "proposals": [ { "target": "existing|new", "name": "<rule name>", "kind": "formula|rule|constraint (new only)", "reconciliation": "consistent|divergent|requested-only|implemented-only", "implemented": { "summary": "", "formula": "", "given": "", "when": "", "then": "", "snippet": "<verbatim code>" }, "note": "" } ] }`
}

// ----------------------------- locate + url -----------------------------

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase()
}

/** Find a verbatim snippet in the read files; compute its 1-based line range. */
function locateSnippet(
  snippet: string,
  files: SourceFile[]
): { path: string; lineStart: number; lineEnd: number } | null {
  const snipLines = snippet.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
  if (snipLines.length === 0) return null
  const first = norm(snipLines[0])
  if (first.length < 4) return null
  for (const f of files) {
    const lines = f.content.split("\n")
    for (let i = 0; i < lines.length; i++) {
      const ln = norm(lines[i])
      if (ln && (ln.includes(first) || first.includes(ln))) {
        const lineStart = i + 1
        const lineEnd = Math.min(lines.length, i + snipLines.length)
        return { path: f.path, lineStart, lineEnd }
      }
    }
  }
  return null
}

/** Build a deep link into the source repo's web UI (ADO _git route). */
export function buildSourceUrl(path: string, lineStart?: number, lineEnd?: number): string | undefined {
  const base = process.env.SRC_ADO_BASE_URL?.replace(/\/$/, "")
  const project = process.env.SRC_ADO_PROJECT
  const repo = process.env.SRC_ADO_REPO
  const branch = process.env.SRC_ADO_BRANCH || "main"
  if (!base || !project || !repo) return undefined
  const p = path.startsWith("/") ? path : `/${path}`
  const params = new URLSearchParams({
    path: p,
    version: `GB${branch}`,
    lineStartColumn: "1",
    lineEndColumn: "1",
    lineStyle: "plain",
    _a: "contents",
  })
  if (lineStart) params.set("line", String(lineStart))
  if (lineEnd) params.set("lineEnd", String(lineEnd))
  return `${base}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}?${params.toString()}`
}

// ----------------------------- parse / validate -----------------------------

export function parseRuleAuditProposals(
  text: string,
  component: Component,
  files: SourceFile[],
  capturedAt: string
): RuleAuditProposal[] {
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

  const ruleNames = new Map((component.rules || []).map((r) => [r.name.toLowerCase(), r]))
  const branch = process.env.SRC_ADO_BRANCH || "main"
  const rawList = Array.isArray(parsed.proposals) ? parsed.proposals : []
  const out: RuleAuditProposal[] = []

  for (const p of rawList as Record<string, unknown>[]) {
    const target = p.target === "new" ? "new" : "existing"
    const name = typeof p.name === "string" ? p.name.trim() : ""
    if (!name) continue
    const existing = ruleNames.get(name.toLowerCase())
    if (target === "existing" && !existing) continue // must reference a real rule
    if (target === "new" && existing) continue // already documented → not new

    let reconciliation: Reconciliation =
      RECONCILIATIONS.includes(p.reconciliation as never) ? (p.reconciliation as Reconciliation) : "requested-only"
    if (target === "new") reconciliation = "implemented-only"

    const impl = (p.implemented as Record<string, unknown>) || {}
    const snippet = typeof impl.snippet === "string" ? impl.snippet.trim() : ""

    let evidence: CodeEvidence | undefined
    if (snippet) {
      const loc = locateSnippet(snippet, files)
      if (loc) {
        evidence = {
          path: loc.path,
          lineStart: loc.lineStart,
          lineEnd: loc.lineEnd,
          snippet,
          url: buildSourceUrl(loc.path, loc.lineStart, loc.lineEnd),
          ref: branch,
          capturedAt,
        }
      }
    }

    // If the model claims it's implemented but we can't locate any code,
    // we can't ground it → downgrade to requested-only and drop the facet.
    const claimsImplemented = reconciliation === "consistent" || reconciliation === "divergent" || target === "new"
    if (claimsImplemented && !evidence) {
      if (target === "new") continue // an undocumented rule with no code citation is worthless
      reconciliation = "requested-only"
    }

    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined)
    const implemented =
      evidence || str(impl.summary) || str(impl.formula)
        ? {
            summary: str(impl.summary),
            formula: str(impl.formula),
            given: str(impl.given),
            when: str(impl.when),
            then: str(impl.then),
            evidence,
          }
        : undefined

    out.push({
      target,
      name,
      kind: target === "new" ? (RULE_KINDS.includes(p.kind as never) ? (p.kind as string) : "rule") : undefined,
      reconciliation,
      implemented,
      note: str(p.note),
    })
  }

  return out
}
