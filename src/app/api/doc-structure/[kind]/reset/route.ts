// POST /api/doc-structure/[kind]/reset → delete the stored structure so
// generation reverts to the built-in default for that kind. Returns the
// (default) structure.

import { NextResponse } from "next/server"
import { resetDocStructure, getDocStructureWithSha } from "@/lib/dsd-structure-store"
import { isDocKind } from "@/lib/doc-kinds"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function POST(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  return withRouteContext(request, async () => {
    const { kind } = await params
    if (!isDocKind(kind)) return NextResponse.json({ error: "Unknown document kind" }, { status: 404 })
    try {
      await resetDocStructure(kind)
      const fresh = await getDocStructureWithSha(kind)
      return NextResponse.json({ ok: true, kind, ...fresh })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      getLogger().error("Failed to reset document structure", { kind, err: message })
      return NextResponse.json({ error: `Failed to reset: ${message}` }, { status: 500 })
    }
  })
}
