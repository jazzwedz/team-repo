// Source-agnostic representation of an imported document. Different
// extractors (PDF, Confluence, future DOCX) all normalise to this shape
// so the rules-import flow does not care where the text came from.

export type SourceKind = "pdf" | "confluence" | "code"

export interface ExtractedDoc {
  kind: SourceKind
  // Human-readable name shown in the UI ("contract.pdf", "Wiki: Pricing rules")
  name: string
  // Plain text (best-effort) ready to feed an LLM
  text: string
  // Optional metadata — currently used for PDFs to surface page count and
  // for Confluence pages to keep the resolved id + URL.
  pages?: number
  confluencePageId?: string
  confluenceUrl?: string
}

export class ExtractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExtractError"
  }
}
