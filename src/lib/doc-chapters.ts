// Chapter plumbing for the section-writer pipeline: splitting a writer's
// markdown into its chapters, matching them to the expected chapter list
// tolerantly, and sizing the writer's token budget.
//
// Why this is its own module: the splitter used to cut on "###" as well as
// "##" and promote every "###" to a chapter heading. That silently threw
// away everything below a chapter's first sub-heading — and the FS is built
// on sub-headings (### UC-NN, ### RG-NN, ### <data object>) — so whole
// chapter bodies went missing. Pure functions, no server imports, unit
// testable.

import type { DsdChapter } from "./dsd-sections"

/** Loose key for a chapter title: number prefix dropped, "&" = "and",
 *  punctuation and case ignored — a model that writes "Actors, Stakeholders
 *  and Glossary" for "4. Actors, Stakeholders & Glossary" must still match. */
export function normTitle(t: string): string {
  return t
    .trim()
    .toLowerCase()
    .replace(/^\d+\.\s*/, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** The leading chapter number of a title ("4. Scope" → "4"), if any. */
export function chapterNumber(t: string): string | undefined {
  const m = t.trim().match(/^(\d+)\./)
  return m ? m[1] : undefined
}

/** Promote a "### <expected chapter title>" to "##" so it splits as a
 *  chapter; every other "###" stays a sub-heading inside its chapter. */
export function promoteChapterHeadings(md: string, chapters: DsdChapter[]): string {
  const keys = new Set(chapters.map((c) => normTitle(c.title)))
  const numbers = new Set(chapters.map((c) => chapterNumber(c.title)).filter(Boolean))
  return md.replace(/^###\s+(.+)$/gm, (line, t: string) => {
    const n = chapterNumber(t)
    return keys.has(normTitle(t)) || (n && numbers.has(n)) ? `## ${t.trim()}` : line
  })
}

/**
 * Split a writer's markdown into chapter blocks keyed by the EXPECTED
 * chapter title's loose key. Splits on "##" only (after promoting expected
 * "###" chapter headings); a chapter whose wording drifted is matched by
 * its number as a second chance. Each block starts with its heading line.
 */
export function splitChapters(md: string, chapters: DsdChapter[]): Map<string, string> {
  const found = new Map<string, string>()
  const byNumber = new Map<string, string>()
  for (const part of promoteChapterHeadings(md, chapters).split(/\n(?=##\s)/)) {
    const m = part.match(/^##\s+(.+)/)
    if (!m) continue
    const block = part.trim()
    const key = normTitle(m[1])
    if (!found.has(key)) found.set(key, block)
    const n = chapterNumber(m[1])
    if (n && !byNumber.has(n)) byNumber.set(n, block)
  }
  const map = new Map<string, string>()
  for (const c of chapters) {
    const key = normTitle(c.title)
    const block = found.get(key) ?? (chapterNumber(c.title) ? byNumber.get(chapterNumber(c.title)!) : undefined)
    if (block) map.set(key, block)
  }
  return map
}

/** Re-head a block with the exact expected title (drops the model's own
 *  first heading line, whatever its wording). */
export function ensureHeading(title: string, text: string): string {
  const body = (text || "").trim().replace(/^#{1,6}\s+.*(?:\r?\n)+/, "")
  return `## ${title}\n\n${body}`
}

/** Expected chapters that have no block in the writer's output. */
export function findMissing(md: string, chapters: DsdChapter[]): DsdChapter[] {
  const blocks = splitChapters(md, chapters)
  return chapters.filter((c) => !blocks.has(normTitle(c.title)))
}

/**
 * Output budget for a writer call, by the number of chapters it must
 * write. A flat 2200 tokens truncated groups of three or four table-heavy
 * chapters — the last ones simply never arrived.
 */
export function writerBudget(chapters: number, depth?: "concise" | "standard" | "detailed"): number {
  const base = Math.min(7000, 1500 + 1700 * Math.max(1, chapters))
  if (depth === "detailed") return Math.min(8000, Math.round(base * 1.25))
  if (depth === "concise") return Math.round(base * 0.8)
  return base
}
