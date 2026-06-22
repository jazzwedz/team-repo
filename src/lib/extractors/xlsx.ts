// Dependency-free .xlsx (Office Open XML spreadsheet) extractor.
//
// Standalone + reusable: turns an .xlsx buffer into a plain-text rendering
// (per sheet: a markdown table of cell values + a list of cell formulas)
// that any LLM flow can consume — today the per-component Rules &
// Calculations import, later the Catalog Curator or anything else. It does
// NOT know about components; it just produces an ExtractedDoc.
//
// .xlsx is a ZIP of XML, read here with the built-in `readZipEntries` (no
// npm dependency, so it installs on the locked-down corporate registry).
// Legacy binary .xls (BIFF) is a different format and is intentionally not
// supported — open it in Excel and "Save As .xlsx".

import { readZipEntries } from "../zip"
import { ExtractError, type ExtractedDoc } from "./types"

// Caps so a huge workbook can't blow the LLM budget.
const MAX_SHEETS = 20
const MAX_ROWS = 400
const MAX_COLS = 50
const MAX_FORMULAS = 400

// ----------------------------- xml helpers -----------------------------

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&") // last, so &amp;lt; stays &lt;
}

/** Concatenate every <t>…</t> inside a chunk (handles rich-text runs). */
function joinTextNodes(chunk: string): string {
  const parts = [...chunk.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]))
  return parts.join("")
}

/** Column letters ("A","AB") → 0-based index. */
function colToIndex(letters: string): number {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** "AB12" → { col: index, row: 1-based number }. */
function parseRef(ref: string): { col: number; row: number } | null {
  const m = ref.match(/^([A-Z]+)(\d+)$/)
  if (!m) return null
  return { col: colToIndex(m[1]), row: parseInt(m[2], 10) }
}

function colName(index: number): string {
  let s = ""
  let n = index + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// ----------------------------- workbook parts -----------------------------

function parseSharedStrings(buf: Buffer | undefined): string[] {
  if (!buf) return []
  const xml = buf.toString("utf8")
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => joinTextNodes(m[1]))
}

/** Resolve sheet name → worksheet xml path via workbook.xml + its rels. */
function sheetOrder(entries: Map<string, Buffer>): { name: string; path: string }[] {
  const wb = entries.get("xl/workbook.xml")?.toString("utf8") || ""
  const rels = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") || ""
  const ridToTarget = new Map<string, string>()
  for (const m of rels.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/g)) {
    ridToTarget.set(m[1], m[2])
  }
  const out: { name: string; path: string }[] = []
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const tag = m[0]
    const name = decodeXml(tag.match(/name="([^"]*)"/)?.[1] || "Sheet")
    const rid = tag.match(/r:id="([^"]+)"/)?.[1]
    let target = rid ? ridToTarget.get(rid) : undefined
    if (target) {
      target = target.replace(/^\//, "")
      const path = target.startsWith("xl/") ? target : `xl/${target}`
      out.push({ name, path })
    }
  }
  // Fallback: if mapping failed, just take the worksheet files in order.
  if (out.length === 0) {
    for (const key of entries.keys()) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(key)) out.push({ name: key.split("/").pop()!, path: key })
    }
  }
  return out
}

function parseSheet(
  xml: string,
  shared: string[]
): { table: string; formulas: { ref: string; formula: string }[] } {
  const cells: { col: number; row: number; ref: string; value: string }[] = []
  const formulas: { ref: string; formula: string }[] = []
  let maxCol = -1
  let maxRow = 0

  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1]
    const inner = m[2] || ""
    const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1]
    if (!ref) continue
    const pos = parseRef(ref)
    if (!pos) continue
    if (pos.row > MAX_ROWS || pos.col >= MAX_COLS) continue

    const f = inner.match(/<f[^>]*>([\s\S]*?)<\/f>/)?.[1]
    if (f && formulas.length < MAX_FORMULAS) formulas.push({ ref, formula: decodeXml(f) })

    const type = attrs.match(/t="([^"]+)"/)?.[1]
    let value = ""
    if (type === "s") {
      const idx = parseInt(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "", 10)
      value = Number.isFinite(idx) ? shared[idx] || "" : ""
    } else if (type === "inlineStr") {
      value = joinTextNodes(inner)
    } else if (type === "str") {
      value = decodeXml(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "")
    } else {
      value = decodeXml(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "")
    }
    if (!value && !f) continue
    cells.push({ col: pos.col, row: pos.row, ref, value })
    if (pos.col > maxCol) maxCol = pos.col
    if (pos.row > maxRow) maxRow = pos.row
  }

  if (maxCol < 0) return { table: "", formulas }

  // Build a markdown table: header = column letters, one row per used row.
  const grid = new Map<string, string>()
  for (const c of cells) grid.set(`${c.row}:${c.col}`, c.value.replace(/\|/g, "\\|").replace(/\n/g, " "))
  const header = "| | " + Array.from({ length: maxCol + 1 }, (_, c) => colName(c)).join(" | ") + " |"
  const sep = "|---|" + Array.from({ length: maxCol + 1 }, () => "---").join("|") + "|"
  const rows: string[] = []
  for (let r = 1; r <= Math.min(maxRow, MAX_ROWS); r++) {
    const line = Array.from({ length: maxCol + 1 }, (_, c) => grid.get(`${r}:${c}`) || "")
    if (line.every((x) => x === "")) continue
    rows.push(`| ${r} | ` + line.join(" | ") + " |")
  }
  const table = rows.length ? [header, sep, ...rows].join("\n") : ""
  return { table, formulas }
}

// ----------------------------- entrypoint -----------------------------

export async function extractXlsx(buffer: Buffer, filename: string): Promise<ExtractedDoc> {
  let entries: Map<string, Buffer>
  try {
    entries = readZipEntries(buffer)
  } catch {
    throw new ExtractError(
      `"${filename}" is not a readable .xlsx (Office Open XML) file. If it is an old binary .xls, open it in Excel and "Save As .xlsx".`
    )
  }
  if (!entries.has("xl/workbook.xml")) {
    throw new ExtractError(`"${filename}" does not look like an Excel .xlsx workbook.`)
  }

  const shared = parseSharedStrings(entries.get("xl/sharedStrings.xml"))
  const sheets = sheetOrder(entries).slice(0, MAX_SHEETS)

  const blocks: string[] = []
  for (const sh of sheets) {
    const xml = entries.get(sh.path)
    if (!xml) continue
    const { table, formulas } = parseSheet(xml.toString("utf8"), shared)
    if (!table && formulas.length === 0) continue
    const parts = [`## Sheet: ${sh.name}`]
    if (table) parts.push(table)
    if (formulas.length) {
      parts.push("Formulas (authoritative calculation logic):\n" + formulas.map((f) => `- ${f.ref} = ${f.formula}`).join("\n"))
    }
    blocks.push(parts.join("\n\n"))
  }

  if (blocks.length === 0) {
    throw new ExtractError(`"${filename}" has no readable cell data or formulas.`)
  }

  const text = [
    `Spreadsheet "${filename}" — cell values and formulas, per sheet.`,
    `The FORMULAS are the authoritative calculation logic; the TABLE ROWS are worked examples (inputs and computed outputs). Dates may appear as Excel serial numbers.`,
    ...blocks,
  ].join("\n\n")

  return { kind: "spreadsheet", name: filename, text }
}
