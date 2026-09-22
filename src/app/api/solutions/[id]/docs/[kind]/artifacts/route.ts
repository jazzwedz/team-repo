// GET /api/solutions/[id]/docs/[kind]/artifacts — list saved documents of
// one kind (dsd, fs, …) for a solution.

import { NextResponse } from "next/server"
import { listDsd } from "@/lib/dsd-store"
import { isDocKind, DOC_KINDS } from "@/lib/doc-kinds"
import { isValidName } from "@/lib/validate"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; kind: string }> }
) {
  return withRouteContext(request, async () => {
    const { id, kind } = await params
    if (!isValidName(id)) {
      return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
    }
    if (!isDocKind(kind)) {
      return NextResponse.json({ error: "Unknown document kind" }, { status: 404 })
    }
    try {
      const artifacts = await listDsd(id, kind)
      return NextResponse.json(artifacts)
    } catch (error) {
      getLogger().error(`Failed to list ${DOC_KINDS[kind].short} artifacts`, {
        id,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json({ error: `Failed to list ${DOC_KINDS[kind].short}s` }, { status: 500 })
    }
  })
}
