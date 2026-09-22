// GET /api/doc-structure/[kind]  → the editable output structure of a document kind (+ sha)
// PUT /api/doc-structure/[kind]  → save an edited structure { structure, sha }
//
// The structure defines WHAT chapters the document has (titles + guidance),
// which writer owns each, and the critics' focus. Generation reads it
// instead of the built-in default once an analyst has saved one.

import { NextResponse } from "next/server"
import { getDocStructureWithSha, saveDocStructure, type DocStructure } from "@/lib/dsd-structure-store"
import { isDocKind, DOC_KINDS } from "@/lib/doc-kinds"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  return withRouteContext(request, async () => {
    const { kind } = await params
    if (!isDocKind(kind)) return NextResponse.json({ error: "Unknown document kind" }, { status: 404 })
    try {
      const { structure, sha } = await getDocStructureWithSha(kind)
      return NextResponse.json({ kind, label: DOC_KINDS[kind].label, short: DOC_KINDS[kind].short, structure, sha })
    } catch (error) {
      getLogger().error("Failed to load document structure", {
        kind,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json({ error: "Failed to load structure" }, { status: 500 })
    }
  })
}

export async function PUT(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  return withRouteContext(request, async () => {
    const { kind } = await params
    if (!isDocKind(kind)) return NextResponse.json({ error: "Unknown document kind" }, { status: 404 })
    let body: { structure?: DocStructure; sha?: string }
    try {
      body = (await request.json()) as { structure?: DocStructure; sha?: string }
    } catch {
      return NextResponse.json({ error: "Body must be JSON." }, { status: 400 })
    }
    if (!body.structure || typeof body.structure !== "object") {
      return NextResponse.json({ error: "Missing 'structure'." }, { status: 400 })
    }
    try {
      await saveDocStructure(kind, body.structure, body.sha)
      const fresh = await getDocStructureWithSha(kind)
      return NextResponse.json({ ok: true, kind, ...fresh })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      getLogger().error("Failed to save document structure", { kind, err: message })
      return NextResponse.json({ error: `Failed to save: ${message}` }, { status: 500 })
    }
  })
}
