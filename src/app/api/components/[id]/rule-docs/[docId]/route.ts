// GET    /api/components/[id]/rule-docs/[docId]  → one stored doc (with text)
// DELETE /api/components/[id]/rule-docs/[docId]  → remove a stored doc

import { NextResponse } from "next/server"
import { getRuleDoc, deleteRuleDoc } from "@/lib/rule-docs-store"
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
      return NextResponse.json({ error: "Invalid component id" }, { status: 400 })
    }
    try {
      const doc = await getRuleDoc(id, docId)
      return NextResponse.json(doc)
    } catch {
      return NextResponse.json({ error: "Rule document not found" }, { status: 404 })
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
      return NextResponse.json({ error: "Invalid component id" }, { status: 400 })
    }
    try {
      await deleteRuleDoc(id, docId)
      return NextResponse.json({ success: true })
    } catch (error) {
      getLogger().error("Failed to delete rule doc", {
        id,
        docId,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json({ error: "Failed to delete rule source document" }, { status: 500 })
    }
  })
}
