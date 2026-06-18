// POST /api/catalog-curator
//
// Catalog Curator — read an uploaded PDF (multipart field `file`) and
// propose catalog improvements grounded in it. The document is transient:
// extracted to text in-memory, analysed, and discarded — never stored.
//
// Returns advisory proposals only (Add / Update / Conflict on existing
// components, each with a page-cited verbatim quote, confidence and
// rationale). Nothing is written; the analyst approves via the dialog,
// which applies each through the normal component save.

import { NextResponse } from "next/server"
import { listComponents } from "@/lib/github"
import { listSolutions } from "@/lib/solutions"
import { isLLMConfigured, LLM_DISABLED_MESSAGE, getLLM } from "@/lib/llm"
import { checkRateLimit } from "@/lib/rate-limit"
import { getAgent, agentInstruction } from "@/lib/agents"
import { extractPdfPages, checkDocSize, ExtractError } from "@/lib/extractors"
import {
  buildPagedText,
  buildCuratorPrompt,
  parseCuratorProposals,
} from "@/lib/catalog-curator"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function POST(request: Request) {
  return withRouteContext(request, async () => {
    if (!isLLMConfigured()) {
      return NextResponse.json({ error: LLM_DISABLED_MESSAGE }, { status: 503 })
    }
    const clientIp = request.headers.get("x-forwarded-for") || "unknown"
    if (!checkRateLimit(clientIp)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a minute before trying again." },
        { status: 429 }
      )
    }

    // --- read the uploaded PDF (transient) ---
    let pagedText: string
    let docName: string
    let pages: Awaited<ReturnType<typeof extractPdfPages>>["pages"]
    try {
      const form = await request.formData()
      const file = form.get("file")
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Upload a PDF in the `file` field." }, { status: 400 })
      }
      const buf = Buffer.from(await file.arrayBuffer())
      const doc = await extractPdfPages(buf, file.name || "document.pdf")
      const size = checkDocSize(doc.text)
      if (!size.ok) {
        return NextResponse.json(
          { error: `Document too large (${size.chars} chars, max ${size.maxChars}). Split it and try again.` },
          { status: 413 }
        )
      }
      pages = doc.pages
      docName = doc.name
      pagedText = buildPagedText(doc.pages)
    } catch (error) {
      const msg = error instanceof ExtractError ? error.message : "Failed to read the uploaded file."
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    // --- analyse against the catalog ---
    try {
      const components = await listComponents()
      const solutions = await listSolutions().catch(() => [])
      if (components.length === 0) {
        return NextResponse.json({ docName, components: 0, proposals: [] })
      }

      const agent = await getAgent("catalog-curator")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const llm: any = await getLLM()
      const raw: string = await llm.complete({
        prompt: buildCuratorPrompt(agentInstruction(agent), pagedText, components, solutions),
        maxTokens: 4000,
      })

      const proposals = parseCuratorProposals(raw, components, pages)
      getLogger().info("Catalog curator complete", {
        docName,
        components: components.length,
        proposed: proposals.length,
      })
      return NextResponse.json({ docName, components: components.length, proposals })
    } catch (error) {
      getLogger().error("Catalog curator failed", {
        docName,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json(
        { error: `Curation failed: ${error instanceof Error ? error.message : "Unknown error"}` },
        { status: 500 }
      )
    }
  })
}
