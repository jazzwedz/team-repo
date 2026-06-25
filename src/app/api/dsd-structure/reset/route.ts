// POST /api/dsd-structure/reset → delete the stored structure so generation
// reverts to the built-in default. Returns the (default) structure.

import { NextResponse } from "next/server"
import { resetDsdStructure, getDsdStructureWithSha } from "@/lib/dsd-structure-store"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  return withRouteContext(request, async () => {
    try {
      await resetDsdStructure()
      const fresh = await getDsdStructureWithSha()
      return NextResponse.json({ ok: true, ...fresh })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      getLogger().error("Failed to reset DSD structure", { err: message })
      return NextResponse.json({ error: `Failed to reset: ${message}` }, { status: 500 })
    }
  })
}
