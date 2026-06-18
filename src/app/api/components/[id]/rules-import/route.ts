// Two-pass rules-import endpoint.
//
// Accepts either a multipart upload (one PDF) or a JSON body with a
// Confluence URL / page id. Extracts text, hard-caps the size, runs
// Pass 1 (relevance filter) when the document is large enough to
// benefit, then Pass 2 (structured extraction) on the filtered passages.
// Returns the rule candidates for the analyst to review in the import
// modal — never persists anything to the catalog itself; that happens
// through the existing PUT /api/components/[id] save flow.

import { NextResponse } from "next/server"
import { getComponent } from "@/lib/github"
import { checkRateLimit } from "@/lib/rate-limit"
import { isValidName } from "@/lib/validate"
import { isLLMConfigured, LLM_DISABLED_MESSAGE } from "@/lib/llm"
import {
  ExtractError,
  checkDocSize,
  extractConfluence,
  extractPdf,
  extractCode,
  type ExtractedDoc,
} from "@/lib/extractors"
import {
  identifyRelevantSections,
  wholeDocAsSingleSection,
  SKIP_PASS_1_CHARS,
} from "@/lib/rules-import/identify"
import { extractRuleCandidates } from "@/lib/rules-import/extract"
import type { RulesImportError } from "@/lib/rules-import/types"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

// Allow up to ~12 MB body for PDF uploads.
export const maxDuration = 60

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRouteContext(request, () => doPost(request, params))
}

async function doPost(
  request: Request,
  params: Promise<{ id: string }>
) {
  try {
    const { id } = await params
    if (!isValidName(id)) {
      return NextResponse.json(
        { ok: false, error: "invalid-id", message: "Invalid component id." },
        { status: 400 }
      )
    }

    if (!isLLMConfigured()) {
      return jsonError({
        ok: false,
        error: "llm-not-configured",
        message: LLM_DISABLED_MESSAGE,
      }, 503)
    }

    const clientIp = request.headers.get("x-forwarded-for") || "unknown"
    if (!checkRateLimit(clientIp)) {
      return NextResponse.json(
        { ok: false, error: "rate-limited", message: "Too many requests. Please wait a minute before trying again." },
        { status: 429 }
      )
    }

    // Component is fetched once — Pass 1 and Pass 2 both need its metadata.
    const component = await getComponent(id)

    const contentType = (request.headers.get("content-type") || "").toLowerCase()
    let doc: ExtractedDoc
    try {
      if (contentType.includes("multipart/form-data")) {
        doc = await extractFromMultipart(request)
      } else {
        doc = await extractFromJson(request)
      }
    } catch (e) {
      if (e instanceof ExtractError) {
        return jsonError({
          ok: false,
          error: "extract-failed",
          message: e.message,
        }, 400)
      }
      throw e
    }

    // Hard cap. Surfaced before any LLM call so the user pays no tokens
    // when the input is too large.
    const sizeCheck = checkDocSize(doc.text)
    if (!sizeCheck.ok) {
      return jsonError({
        ok: false,
        error: "token-cap-exceeded",
        message: `Document "${doc.name}" is too large: ${sizeCheck.chars.toLocaleString()} characters (~${sizeCheck.estimatedTokens.toLocaleString()} tokens). The maximum is ${sizeCheck.maxChars.toLocaleString()} characters. Split it into smaller documents or extract the relevant section manually before importing.`,
        docChars: sizeCheck.chars,
        maxChars: sizeCheck.maxChars,
      }, 413)
    }

    const t0 = Date.now()
    const sourceKind: "doc" | "code" = doc.kind === "code" ? "code" : "doc"
    const language: string | undefined =
      doc.kind === "code"
        ? (doc as ExtractedDoc & { language?: string }).language
        : undefined

    // Pass 1 — skipped for short documents.
    let sections
    let pass1Ms: number | undefined
    let pass1Skipped = false
    if (doc.text.length < SKIP_PASS_1_CHARS) {
      pass1Skipped = true
      sections = wholeDocAsSingleSection(doc.name, doc.text)
    } else {
      const p1 = await identifyRelevantSections(
        component,
        doc.name,
        doc.text,
        sourceKind,
        language
      )
      pass1Ms = p1.ms
      sections = p1.sections
    }

    if (sections.length === 0) {
      return NextResponse.json({
        ok: false,
        error: "no-relevant-sections",
        message: `No passages in "${doc.name}" appear to describe rules, calculations or constraints for component "${component.name}". Try a more specific ${sourceKind === "code" ? "source file" : "document"}.`,
      } as RulesImportError, { status: 200 })
    }

    // Pass 2 — extract structured candidates.
    const p2 = await extractRuleCandidates(component, sections, sourceKind, language)

    if (p2.candidates.length === 0) {
      return NextResponse.json({
        ok: false,
        error: "no-candidates",
        message: `Pass 1 surfaced ${sections.length} relevant section(s) but no concrete rules could be extracted. The source may be too narrative — try a document with explicit formulas, Given/When/Then statements or numbered constraints.`,
      } as RulesImportError, { status: 200 })
    }

    return NextResponse.json({
      ok: true,
      candidates: p2.candidates,
      meta: {
        docName: doc.name,
        docChars: doc.text.length,
        pass1Skipped,
        relevantSectionsCount: sections.length,
        candidatesCount: p2.candidates.length,
        pass1Ms,
        pass2Ms: p2.ms,
        totalMs: Date.now() - t0,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    getLogger().error("rules-import failed", { err: message })
    return NextResponse.json(
      { ok: false, error: "ai-failed", message: `Failed to run rules-import: ${message}` },
      { status: 500 }
    )
  }
}

async function extractFromMultipart(request: Request): Promise<ExtractedDoc> {
  const form = await request.formData()
  const file = form.get("file")
  if (!(file instanceof File)) {
    throw new ExtractError("No file uploaded under field 'file'.")
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ExtractError(
      `File too large: ${(file.size / 1024 / 1024).toFixed(1)} MB (max ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB).`
    )
  }
  const name = file.name || "upload"
  const lower = name.toLowerCase()
  const isPdf = lower.endsWith(".pdf")
  const declaredKind = (form.get("kind") as string | null) || (isPdf ? "pdf" : "code")
  if (declaredKind === "pdf") {
    if (!isPdf) {
      throw new ExtractError(
        `Unsupported file type for kind=pdf: "${name}". Use a .pdf file.`
      )
    }
    const buf = Buffer.from(await file.arrayBuffer())
    return extractPdf(buf, name)
  }
  if (declaredKind === "code") {
    const text = await file.text()
    const language = (form.get("language") as string | null) || undefined
    return extractCode({ text, filename: name, language })
  }
  throw new ExtractError(
    `Unsupported upload kind "${declaredKind}". Use "pdf" or "code".`
  )
}

async function extractFromJson(request: Request): Promise<ExtractedDoc> {
  let body: {
    source?: {
      type?: string
      url?: string
      text?: string
      language?: string
      filename?: string
    }
  }
  try {
    body = await request.json()
  } catch {
    throw new ExtractError("Invalid JSON body.")
  }
  const src = body.source
  if (!src || typeof src !== "object") {
    throw new ExtractError(
      `Body must contain { source: { type: "confluence" | "code", ... } } or upload a file as multipart form-data.`
    )
  }
  if (src.type === "confluence") {
    if (typeof src.url !== "string" || !src.url.trim()) {
      throw new ExtractError("Missing or empty Confluence url / page id.")
    }
    return extractConfluence(src.url.trim())
  }
  if (src.type === "code") {
    if (typeof src.text !== "string" || !src.text.trim()) {
      throw new ExtractError("Missing or empty 'text' for source.type=code.")
    }
    return extractCode({
      text: src.text,
      filename: src.filename,
      language: src.language,
    })
  }
  throw new ExtractError(
    `Unsupported source type "${src.type}". Use "confluence", "code", or upload a PDF.`
  )
}

function jsonError(body: RulesImportError, status: number): NextResponse {
  return NextResponse.json(body, { status })
}
