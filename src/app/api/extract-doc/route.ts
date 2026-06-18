// POST /api/extract-doc
//
// Extracts plain text from an uploaded document (PDF) or a Confluence
// URL / pasted text — no LLM. Used by the Solution composer to pre-fill
// the description from a BRD. Reuses the same extractors as rules-import.

import { NextResponse } from "next/server"
import {
  ExtractError,
  checkDocSize,
  extractConfluence,
  extractPdf,
  extractCode,
  type ExtractedDoc,
} from "@/lib/extractors"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024

export async function POST(request: Request) {
  return withRouteContext(request, async () => {
    const contentType = (request.headers.get("content-type") || "").toLowerCase()
    let doc: ExtractedDoc
    try {
      doc = contentType.includes("multipart/form-data")
        ? await extractFromMultipart(request)
        : await extractFromJson(request)
    } catch (e) {
      if (e instanceof ExtractError) {
        return NextResponse.json({ error: e.message }, { status: 400 })
      }
      getLogger().error("extract-doc failed", {
        err: e instanceof Error ? e.message : String(e),
      })
      return NextResponse.json({ error: "Failed to extract document" }, { status: 500 })
    }

    const size = checkDocSize(doc.text)
    if (!size.ok) {
      return NextResponse.json(
        {
          error: `Document "${doc.name}" is too large (${size.chars.toLocaleString()} characters; max ${size.maxChars.toLocaleString()}). Use a smaller file or paste the relevant part.`,
        },
        { status: 413 }
      )
    }

    return NextResponse.json({ name: doc.name, text: doc.text, chars: doc.text.length })
  })
}

async function extractFromMultipart(request: Request): Promise<ExtractedDoc> {
  const form = await request.formData()
  const file = form.get("file")
  if (!(file instanceof File)) throw new ExtractError("No file uploaded under field 'file'.")
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ExtractError(
      `File too large: ${(file.size / 1024 / 1024).toFixed(1)} MB (max ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB).`
    )
  }
  const name = file.name || "upload"
  if (name.toLowerCase().endsWith(".pdf")) {
    const buf = Buffer.from(await file.arrayBuffer())
    return extractPdf(buf, name)
  }
  // Treat any other uploaded file as text (txt/md/etc.).
  const text = await file.text()
  return extractCode({ text, filename: name })
}

async function extractFromJson(request: Request): Promise<ExtractedDoc> {
  let body: { source?: { type?: string; url?: string; text?: string } }
  try {
    body = await request.json()
  } catch {
    throw new ExtractError("Invalid JSON body.")
  }
  const src = body.source
  if (!src || typeof src !== "object") {
    throw new ExtractError(`Body must be { source: { type: "confluence" | "text", ... } } or a file upload.`)
  }
  if (src.type === "confluence") {
    if (typeof src.url !== "string" || !src.url.trim()) {
      throw new ExtractError("Missing Confluence url / page id.")
    }
    return extractConfluence(src.url.trim())
  }
  if (src.type === "text") {
    if (typeof src.text !== "string" || !src.text.trim()) {
      throw new ExtractError("Missing 'text'.")
    }
    return extractCode({ text: src.text, filename: "pasted" })
  }
  throw new ExtractError(`Unsupported source type "${src.type}".`)
}
