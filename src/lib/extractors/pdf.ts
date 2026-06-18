// PDF text extractor — runs server-side so the route handler stays
// the single trust boundary for uploaded files. pdf-parse v2 wraps
// pdfjs-dist and handles font dictionaries / layout heuristics; we
// just normalise the text and surface the page count.

import { ExtractError, type ExtractedDoc } from "./types"

export async function extractPdf(
  buffer: Buffer,
  filename: string
): Promise<ExtractedDoc> {
  // Imported lazily so the heavy pdf-parse / pdfjs-dist stack is only
  // loaded when a PDF is actually parsed — the Confluence and code
  // import paths never touch it.
  const { PDFParse } = await import("pdf-parse")
  const parser = new PDFParse({
    data: new Uint8Array(buffer),
  })
  try {
    const result = await parser.getText()
    const text = (result.text || "").trim()
    if (!text) {
      throw new ExtractError(
        `PDF "${filename}" contains no extractable text — it may be a scanned image. Run OCR first or upload a different document.`
      )
    }
    return {
      kind: "pdf",
      name: filename,
      text,
      pages: result.pages?.length,
    }
  } catch (err) {
    if (err instanceof ExtractError) throw err
    throw new ExtractError(
      `Failed to parse PDF "${filename}": ${err instanceof Error ? err.message : String(err)}`
    )
  } finally {
    try {
      await parser.destroy()
    } catch {
      // ignore cleanup errors
    }
  }
}

/** One page of extracted PDF text (1-based page number). */
export interface PdfPage {
  num: number
  text: string
}

/** A PDF extracted with its per-page text preserved. */
export interface PagedPdf {
  name: string
  /** Concatenated whole-document text (same as extractPdf). */
  text: string
  /** Per-page text, in order. Lets callers cite "page N + verbatim quote". */
  pages: PdfPage[]
}

/**
 * Like extractPdf, but keeps the per-page text. pdf-parse v2's getText()
 * already returns `pages: { num, text }[]`; extractPdf just collapses it
 * to a count. The Catalog Curator needs page-level text so it can cite a
 * page number and validate that a quoted passage really appears on it.
 */
export async function extractPdfPages(
  buffer: Buffer,
  filename: string
): Promise<PagedPdf> {
  const { PDFParse } = await import("pdf-parse")
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  try {
    const result = await parser.getText()
    const text = (result.text || "").trim()
    if (!text) {
      throw new ExtractError(
        `PDF "${filename}" contains no extractable text — it may be a scanned image. Run OCR first or upload a different document.`
      )
    }
    const pages: PdfPage[] = (result.pages || []).map((p) => ({
      num: p.num,
      text: (p.text || "").trim(),
    }))
    return { name: filename, text, pages }
  } catch (err) {
    if (err instanceof ExtractError) throw err
    throw new ExtractError(
      `Failed to parse PDF "${filename}": ${err instanceof Error ? err.message : String(err)}`
    )
  } finally {
    try {
      await parser.destroy()
    } catch {
      // ignore cleanup errors
    }
  }
}
