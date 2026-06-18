// GET /api/confluence/pages
//
// Flat list of pages in the configured Confluence space, used to render
// the parent-page picker when publishing a DSD. Returns { configured,
// pages } so the UI can disable the picker gracefully when Confluence is
// not set up.

import { NextResponse } from "next/server"
import { isConfluenceConfigured, listSpacePages } from "@/lib/confluence"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return withRouteContext(request, async () => {
    if (!isConfluenceConfigured()) {
      return NextResponse.json({ configured: false, pages: [] })
    }
    try {
      const pages = await listSpacePages()
      return NextResponse.json({ configured: true, pages })
    } catch (error) {
      getLogger().error("Failed to list Confluence pages", {
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json(
        { configured: true, pages: [], error: "Failed to list Confluence pages" },
        { status: 502 }
      )
    }
  })
}
