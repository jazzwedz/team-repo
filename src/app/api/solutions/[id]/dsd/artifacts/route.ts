// GET /api/solutions/[id]/dsd/artifacts — list saved DSDs for a solution.

import { NextResponse } from "next/server"
import { listDsd } from "@/lib/dsd-store"
import { isValidName } from "@/lib/validate"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRouteContext(request, async () => {
    const { id } = await params
    if (!isValidName(id)) {
      return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
    }
    try {
      const artifacts = await listDsd(id)
      return NextResponse.json(artifacts)
    } catch (error) {
      getLogger().error("Failed to list DSD artifacts", {
        id,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json({ error: "Failed to list DSDs" }, { status: 500 })
    }
  })
}
