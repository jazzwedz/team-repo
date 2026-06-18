import { NextResponse } from "next/server"
import { getComponent, getConfluenceLink, saveConfluenceLink } from "@/lib/github"
import { isValidName } from "@/lib/validate"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"
import {
  isConfluenceConfigured,
  createPage,
  updatePage,
  getPage,
  findOrCreateCapabilityPage,
  findPageByComponentId,
} from "@/lib/confluence"
import {
  buildPageBody,
  pageTitleFor,
  capabilityForHierarchy,
} from "@/lib/confluence-render"

export const dynamic = "force-dynamic"

interface PublishBody {
  componentId: string
  audienceLabel?: string
  narrativeMarkdown: string
}

export async function POST(request: Request) {
  return withRouteContext(request, () => doPost(request))
}

async function doPost(request: Request) {
  try {
    if (!isConfluenceConfigured()) {
      return NextResponse.json(
        {
          error:
            "Confluence is not configured. Set CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN, CONFLUENCE_SPACE_ID env vars.",
        },
        { status: 503 }
      )
    }

    const body = (await request.json()) as PublishBody
    const componentId = body.componentId
    if (!componentId || !isValidName(componentId)) {
      return NextResponse.json(
        { error: "Invalid or missing componentId" },
        { status: 400 }
      )
    }
    if (!body.narrativeMarkdown || body.narrativeMarkdown.trim().length === 0) {
      return NextResponse.json(
        { error: "Missing narrativeMarkdown — generate the document first." },
        { status: 400 }
      )
    }

    const component = await getComponent(componentId)
    const audienceLabel = body.audienceLabel || "Technical"

    // Hierarchy mirror: ensure the parent capability page exists.
    const capabilityName = capabilityForHierarchy(component)
    const parent = await findOrCreateCapabilityPage(capabilityName)

    const storageBody = await buildPageBody({
      component,
      audienceLabel,
      narrativeMarkdown: body.narrativeMarkdown,
    })
    const title = pageTitleFor(component)

    // Resolve the existing page via two strategies, in order:
    //   1) side-file in arch-data repo (fast, survives renames)
    //   2) title-based scan in Confluence space (works without repo access)
    let existingPageId: string | undefined
    let existingLinkSha: string | undefined
    try {
      const linked = await getConfluenceLink(componentId)
      if (linked) {
        existingPageId = linked.pageId
        existingLinkSha = linked.sha
      }
    } catch (err) {
      getLogger().warn(`getConfluenceLink failed for ${componentId} (continuing with title fallback)`, {
        err: err instanceof Error ? err.message : String(err),
      })
    }
    if (!existingPageId) {
      const found = await findPageByComponentId(componentId)
      if (found) existingPageId = found.id
    }

    let pageRef
    let action: "created" | "updated"

    if (existingPageId) {
      try {
        const current = await getPage(existingPageId)
        pageRef = await updatePage({
          pageId: existingPageId,
          title,
          storageBody,
          currentVersion: current.version.number,
          parentId: parent.id,
          message: `synced from arch-tool: ${componentId}`,
        })
        action = "updated"
      } catch (err) {
        // Page might have been deleted in Confluence; fall through to create.
        getLogger().warn(`Confluence page ${existingPageId} no longer accessible, recreating`, {
          err: err instanceof Error ? err.message : String(err),
        })
        pageRef = await createPage({
          title,
          storageBody,
          parentId: parent.id,
        })
        action = "created"
      }
    } else {
      pageRef = await createPage({
        title,
        storageBody,
        parentId: parent.id,
      })
      action = "created"
    }

    // Side-file write is best-effort — if the GitHub PAT can't write
    // (e.g., scoped permissions, branch protection), the publish still
    // succeeds and pull falls back to title-based lookup.
    let linkPersisted = true
    let linkWarning: string | undefined
    try {
      await saveConfluenceLink(
        {
          componentId,
          pageId: pageRef.id,
          spaceId: pageRef.spaceId,
          lastSyncedAt: new Date().toISOString(),
          lastPublishedVersion: pageRef.version.number,
        },
        existingLinkSha
      )
    } catch (err) {
      linkPersisted = false
      linkWarning =
        "Confluence page is live, but the link side-file in arch-data could not be written (GitHub PAT permission). Pull will use title-based lookup."
      getLogger().warn(`saveConfluenceLink failed for ${componentId}`, {
        err: err instanceof Error ? err.message : String(err),
      })
    }

    return NextResponse.json({
      action,
      pageId: pageRef.id,
      pageUrl: pageRef.fullUrl,
      capabilityParent: parent.title,
      capabilityParentId: parent.id,
      linkPersisted,
      ...(linkWarning ? { warning: linkWarning } : {}),
    })
  } catch (error: unknown) {
    const status =
      error && typeof error === "object" && "status" in error
        ? (error as { status: number }).status
        : 500
    const message =
      error instanceof Error
        ? error.message
        : error && typeof error === "object" && "message" in error
        ? String((error as { message: string }).message)
        : "Unknown error"
    getLogger().error("Failed to publish to Confluence", { err: message })
    return NextResponse.json(
      { error: `Failed to publish: ${message}` },
      { status: status >= 400 && status < 600 ? status : 500 }
    )
  }
}
