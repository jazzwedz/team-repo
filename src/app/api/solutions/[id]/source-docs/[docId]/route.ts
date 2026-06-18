// GET    /api/solutions/[id]/source-docs/[docId]  → one stored doc (with text)
// DELETE /api/solutions/[id]/source-docs/[docId]  → remove a stored doc

import { NextResponse } from "next/server"
import { getSourceDoc, deleteSourceDoc } from "@/lib/source-docs-store"
import { isValidName } from "@/lib/validate"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  return withRouteContext(request, async () => {
    const { id, docId } = await params
    if (!isValidName(id)) {
      return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
    }
    try {
      const doc = await getSourceDoc(id, docId)
      return NextResponse.json(doc)
    } catch {
      return NextResponse.json({ error: "Source document not found" }, { status: 404 })
    }
  })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  return withRouteContext(request, async () => {
    const { id, docId } = await params
    if (!isValidName(id)) {
      return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
    }
    try {
      await deleteSourceDoc(id, docId)
      return NextResponse.json({ success: true })
    } catch (error) {
      getLogger().error("Failed to delete source doc", {
        id,
        docId,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json({ error: "Failed to delete source document" }, { status: 500 })
    }
  })
}
