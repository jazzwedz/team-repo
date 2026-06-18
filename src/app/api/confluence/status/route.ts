import { NextResponse } from "next/server"
import { isConfluenceConfigured, findPageByComponentId } from "@/lib/confluence"
import { getConfluenceLink } from "@/lib/github"
import { isValidName } from "@/lib/validate"
import { getLogger } from "@/lib/log"
import { withRouteContext } from "@/lib/route-context"

export const dynamic = "force-dynamic"

// GET /api/confluence/status?componentId=xxx
// Reports whether Confluence is configured and whether this component
// already has a published page (side-file first, title-based fallback).
export async function GET(request: Request) {
  return withRouteContext(request, () => doGet(request))
}

async function doGet(request: Request) {
  try {
    const url = new URL(request.url)
    const componentId = url.searchParams.get("componentId") || ""
    const configured = isConfluenceConfigured()
    if (!componentId) {
      return NextResponse.json({ configured })
    }
    if (!isValidName(componentId)) {
      return NextResponse.json({ error: "Invalid component ID" }, { status: 400 })
    }

    let pageId: string | undefined
    let lastSyncedAt: string | undefined
    let pageUrl: string | undefined

    try {
      const link = await getConfluenceLink(componentId)
      if (link) {
        pageId = link.pageId
        lastSyncedAt = link.lastSyncedAt
      }
    } catch {
      // ignore — fall through to title lookup
    }

    if (!pageId && configured) {
      try {
        const found = await findPageByComponentId(componentId)
        if (found) {
          pageId = found.id
          pageUrl = found.fullUrl
        }
      } catch {
        // ignore — return unpublished
      }
    }

    if (pageId && !pageUrl) {
      pageUrl = `${process.env.CONFLUENCE_BASE_URL}/wiki/spaces/${process.env.CONFLUENCE_SPACE_KEY || "TR"}/pages/${pageId}`
    }

    return NextResponse.json({
      configured,
      published: !!pageId,
      pageId,
      lastSyncedAt,
      pageUrl,
    })
  } catch (error) {
    getLogger().error("Failed to get confluence status", { err: error instanceof Error ? error.message : "Unknown error" })
    return NextResponse.json({ error: "Failed to get status" }, { status: 500 })
  }
}
