// GET /api/admin/consistency-check
//
// Scans the whole catalog and returns the deterministic list of
// missing-backlink issues. No state, no caching — every call runs a
// fresh listComponents() + findInconsistencies(). The dialog can
// re-fetch after each successful apply to refresh the list.

import { NextResponse } from "next/server"
import { listComponents } from "@/lib/github"
import { findInconsistencies } from "@/lib/consistency"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return withRouteContext(request, async () => {
    try {
      const components = await listComponents()
      const issues = findInconsistencies(components)
      return NextResponse.json({
        components: components.length,
        issues,
      })
    } catch (error) {
      getLogger().error("Failed to run consistency check", {
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json(
        { error: "Failed to run consistency check" },
        { status: 500 }
      )
    }
  })
}
