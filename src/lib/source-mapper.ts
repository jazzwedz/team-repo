// Source mapper — find which source files implement a component, so the
// analyst (a BA) never has to know the code layout.
//
// Standalone from the rule audit: it only proposes `source.paths`. Once
// those are set (by this scanner or by hand), the code-rule-auditor and
// future code-aware features read them.
//
// Two-phase, bounded, grounded:
//   A. index the repo tree (getSourceGit().listTree, read-only) and
//      shortlist candidate files by name/id/tag keyword match — a huge
//      repo never goes to the LLM whole;
//   B. the source-mapper agent judges which shortlisted files actually
//      implement the component (it sees the candidate paths + a few file
//      heads) and returns paths + confidence + reason.
// Anti-hallucination: only paths that exist in the indexed tree (and were
// offered as candidates) survive parsing.

import { getSourceGit, isSourceCodeConfigured } from "./source-git"
import { codeSearch } from "./code-search"
import { getLogger } from "./log"
import type { Component } from "./types"

// Bounds so a large repo can't blow the prompt / cost budget.
const MAX_INDEX = 6000 // file paths pulled from the tree
const MAX_CANDIDATES = 40 // shortlisted before the LLM
const MAX_HEADS = 8 // candidate files whose head we read for the LLM
const HEAD_CHARS = 1200
const MIN_CONFIDENCE = 0.4
const CONTENT_WEIGHT = 3 // score boost for a content (Code Search / grep) hit
const SCOPE_FOLDERS = 4 // how many top-candidate folders scope the content search
const MAX_GREP_READS = 120 // files read in the grep fallback (bounded)

// Only consider source-ish files; skip binaries, lockfiles, vendored dirs.
const SOURCE_EXT =
  /\.(java|kt|scala|groovy|ts|tsx|js|jsx|py|cs|go|rb|php|c|h|cpp|hpp|sql|xml|yaml|yml|json|properties)$/i
const SKIP_DIR = /(^|\/)(node_modules|dist|build|target|out|vendor|\.git|test|tests|__tests__|spec)(\/|$)/i

export function isSourceMapAvailable(): boolean {
  return isSourceCodeConfigured()
}

export interface SourceCandidate {
  path: string
  score: number
}

/** Tokens from a component used to keyword-match file paths. */
function componentTokens(c: Component): string[] {
  const raw = [
    c.name,
    c.id,
    ...(c.tags || []),
    ...(c.capabilities || []).map((x) => x.name),
  ].join(" ")
  // split camelCase and any non-alphanumeric boundaries
  const parts = raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 3)
  return Array.from(new Set(parts))
}

/** Parent folder of a path, with a leading slash (for the Path filter). */
function parentFolder(path: string): string {
  const i = path.lastIndexOf("/")
  return i < 0 ? "/" : "/" + path.slice(0, i)
}

/**
 * Index the repo and gather candidate files for this component, combining:
 *   1. name/path keyword matches (cheap, no read), which also reveal the
 *      likely folder(s);
 *   2. CONTENT matches scoped to those folders — primary via the ADO Code
 *      Search API (server-side), falling back to a bounded local grep when
 *      the API is unavailable. Content matching catches files that
 *      implement the component without its name in the path.
 */
export async function gatherCandidates(component: Component): Promise<{
  candidates: SourceCandidate[]
  indexed: number
  contentSource: "code-search" | "grep" | "none"
}> {
  const git = getSourceGit()
  const tree = await git.listTree("")
  const files = tree
    .map((e) => e.path)
    .filter((p) => SOURCE_EXT.test(p) && !SKIP_DIR.test(p))
    .slice(0, MAX_INDEX)
  const allowed = new Set(files)

  // 1. Name/path scoring.
  const tokens = componentTokens(component)
  const scoreByPath = new Map<string, number>()
  for (const path of files) {
    const lower = path.toLowerCase()
    const file = lower.split("/").pop() || lower
    let score = 0
    for (const t of tokens) {
      if (file.includes(t)) score += 2 // match in filename weighs more
      else if (lower.includes(t)) score += 1 // match anywhere in the path
    }
    if (score > 0) scoreByPath.set(path, score)
  }

  // Folders to scope the content search: parents of the top name matches.
  const topNamed = [...scoreByPath.entries()].sort((a, b) => b[1] - a[1]).slice(0, SCOPE_FOLDERS)
  const folders = Array.from(new Set(topNamed.map(([p]) => parentFolder(p))))

  // 2. Content matching, scoped to those folders (whole repo if none).
  const terms = component.name.trim() || component.id
  let contentSource: "code-search" | "grep" | "none" = "none"
  try {
    const res = await codeSearch(terms, { top: 50, paths: folders.length ? folders : undefined })
    if (res.ok) {
      contentSource = "code-search"
      for (const hit of res.hits) {
        if (!allowed.has(hit.path)) continue // honour our source/test filters
        scoreByPath.set(hit.path, (scoreByPath.get(hit.path) || 0) + CONTENT_WEIGHT)
      }
    } else {
      throw new Error(res.error || "code search not ok")
    }
  } catch (err) {
    // Fallback: bounded local grep, folder-scoped files first.
    getLogger().info("Source mapper: Code Search unavailable, using grep fallback", {
      err: err instanceof Error ? err.message : String(err),
    })
    contentSource = "grep"
    const inScope = (p: string) => folders.some((f) => ("/" + p).startsWith(f + "/") || "/" + p === f)
    const ordered = [...files].sort((a, b) => Number(inScope(b)) - Number(inScope(a)))
    let reads = 0
    for (const path of ordered) {
      if (reads >= MAX_GREP_READS) break
      try {
        const f = await git.getFile(path)
        reads++
        const content = (f.content || "").toLowerCase()
        if (tokens.some((t) => content.includes(t))) {
          scoreByPath.set(path, (scoreByPath.get(path) || 0) + CONTENT_WEIGHT)
        }
      } catch {
        // unreadable — skip
      }
    }
  }

  const candidates: SourceCandidate[] = [...scoreByPath.entries()]
    .map(([path, score]) => ({ path, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
  return { candidates, indexed: files.length, contentSource }
}

/** Read the head of the top candidates so the LLM can confirm relevance. */
export async function readCandidateHeads(
  candidates: SourceCandidate[]
): Promise<{ path: string; head: string }[]> {
  const git = getSourceGit()
  const out: { path: string; head: string }[] = []
  for (const c of candidates.slice(0, MAX_HEADS)) {
    try {
      const f = await git.getFile(c.path)
      const head = (f.content || "").slice(0, HEAD_CHARS).trim()
      if (head) out.push({ path: c.path, head })
    } catch {
      // unreadable — skip
    }
  }
  return out
}

// ----------------------------- prompt -----------------------------

export function buildMapperPrompt(
  instruction: string,
  component: Component,
  candidates: SourceCandidate[],
  heads: { path: string; head: string }[]
): string {
  const profile = [
    `Name: ${component.name}`,
    `Id: ${component.id}`,
    `Type: ${component.type}`,
    component.description?.description ? `Description: ${component.description.description}` : "",
    (component.capabilities || []).length
      ? `Capabilities: ${(component.capabilities || []).map((x) => x.name).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n")

  const list = candidates.map((c) => `- ${c.path}`).join("\n")
  const headBlocks = heads
    .map((h) => `### ${h.path}\n\`\`\`\n${h.head}\n\`\`\``)
    .join("\n\n")

  return `${instruction}

Identify which of the candidate source files implement the component below. The candidates were shortlisted by name match; judge from the paths and the file heads which ones actually realise this component's behaviour. Prefer a small, precise set — the main implementation files, not every file that merely mentions the name. Return nothing if none clearly fit.

COMPONENT:
${profile}

CANDIDATE FILES (choose only from these exact paths):
${list}

FILE HEADS (first lines of the top candidates):
${headBlocks || "(none readable)"}

Return ONLY JSON, no prose:
{ "files": [ { "path": "<exact candidate path>", "confidence": 0.0, "reason": "<why this file implements the component>" } ] }`
}

// ----------------------------- parse -----------------------------

export interface SourceMapProposal {
  path: string
  confidence: number
  reason: string
}

export function parseSourceMapProposals(
  text: string,
  candidates: SourceCandidate[]
): SourceMapProposal[] {
  let parsed: { files?: unknown }
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
  const allowed = new Set(candidates.map((c) => c.path))
  const seen = new Set<string>()
  const out: SourceMapProposal[] = []
  for (const f of (Array.isArray(parsed.files) ? parsed.files : []) as Record<string, unknown>[]) {
    const path = typeof f.path === "string" ? f.path.trim() : ""
    if (!allowed.has(path) || seen.has(path)) continue // must be a real shortlisted path
    const confidence = typeof f.confidence === "number" ? Math.max(0, Math.min(1, f.confidence)) : 0
    if (confidence < MIN_CONFIDENCE) continue
    seen.add(path)
    out.push({ path, confidence, reason: typeof f.reason === "string" ? f.reason.trim() : "" })
  }
  return out.sort((a, b) => b.confidence - a.confidence)
}
