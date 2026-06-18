export type { ExtractedDoc, SourceKind } from "./types"
export { ExtractError } from "./types"
export { extractPdf, extractPdfPages } from "./pdf"
export type { PagedPdf, PdfPage } from "./pdf"
export { extractConfluence, resolvePageIdFromUrl } from "./confluence"
export { extractCode, detectLanguage } from "./code"
export type { CodeExtractedDoc } from "./code"

// Hard cap on extracted document size before we send anything to the LLM.
// 320_000 chars ≈ ~80K tokens (4 chars / token rule-of-thumb) — generous
// for a 40-80 page document but well below Claude's 200K context window
// so the prompt + response have room to breathe.
export const MAX_DOC_CHARS = 320_000

export interface DocSizeCheck {
  ok: boolean
  chars: number
  maxChars: number
  estimatedTokens: number
}

export function checkDocSize(text: string): DocSizeCheck {
  const chars = text.length
  return {
    ok: chars <= MAX_DOC_CHARS,
    chars,
    maxChars: MAX_DOC_CHARS,
    estimatedTokens: Math.ceil(chars / 4),
  }
}
