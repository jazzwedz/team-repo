// GET  /api/components/[id]/rule-docs   → list stored rule source docs (no bodies)
// POST /api/components/[id]/rule-docs   → save a rule source doc { name, text }
//
// The text is the extracted plain text of a document a component's rules
// were (or will be) imported from. Persisted as a sidecar so the analyst
// can see the provenance and re-extract later. Mirrors the solution
// source-docs route, keyed by component id.

import { NextResponse } from "next/server"
import { listRuleDocs, saveRuleDoc } from "@/lib/rule-docs-store"
import { isValidName } from "@/lib/validate"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

// Hard cap on stored text size (chars). Mirrors the extract-doc limits.
const MAX_TEXT_CHARS = 400_000

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRouteContext(request, async () => {
    const { id } = await params
    if (!isValidName(id)) {
      return NextResponse.json({ error: "Invalid component id" }, { status: 400 })
    }
    try {
      const docs = await listRuleDocs(id)
      return NextResponse.json(docs)
    } catch {
      return NextResponse.json([])
    }
  })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRouteContext(request, async () => {
    const { id } = await params
    if (!isValidName(id)) {
      return NextResponse.json({ error: "Invalid component id" }, { status: 400 })
    }
    let body: { name?: string; text?: string }
    try {
      body = (await request.json()) as { name?: string; text?: string }
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }
    if (typeof body.text !== "string" || !body.text.trim()) {
      return NextResponse.json({ error: "Missing document text" }, { status: 400 })
    }
    if (body.text.length > MAX_TEXT_CHARS) {
      return NextResponse.json(
        { error: `Document too large (${body.text.length.toLocaleString()} chars; max ${MAX_TEXT_CHARS.toLocaleString()}).` },
        { status: 413 }
      )
    }
    try {
      const meta = await saveRuleDoc(id, {
        name: typeof body.name === "string" ? body.name : "rule source document",
        text: body.text,
      })
      return NextResponse.json(meta)
    } catch (error) {
      getLogger().error("Failed to save rule doc", {
        id,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json({ error: "Failed to save rule source document" }, { status: 500 })
    }
  })
}
