// POST /api/solutions/[id]/dsd/artifacts/[artifactId]/publish
//
// One-way publish of a generated DSD to Confluence. The analyst picks a
// parent page (the "sub-directory") in the publish dialog; we render the
// DSD markdown to storage XHTML, create or update the page under that
// parent, and remember the page + parent on the artifact so the next
// publish updates the same page and pre-selects the parent.

import { NextResponse } from "next/server"
import { getDsd, setDsdConfluence, type DsdArtifact } from "@/lib/dsd-store"
import { isValidName } from "@/lib/validate"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"
import {
  isConfluenceConfigured,
  createPage,
  updatePage,
  getPage,
  findPageByTitleInSpace,
  uploadAttachment,
  escapeXml,
} from "@/lib/confluence"
import { markdownToStorage } from "@/lib/confluence-render"

export const dynamic = "force-dynamic"
export const maxDuration = 120

interface PublishImage {
  /** diagram-N.png, matching the document order of the mermaid blocks. */
  filename: string
  /** base64-encoded PNG bytes (no data: prefix). */
  base64: string
}

interface PublishBody {
  parentId: string
  parentTitle?: string
  /** Pre-rendered diagram PNGs (rendered client-side); attached to the page
   *  and referenced from the storage as <ac:image>. */
  images?: PublishImage[]
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  return withRouteContext(request, async () => {
    const { id, artifactId } = await params
    if (!isValidName(id)) {
      return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
    }
    if (!isConfluenceConfigured()) {
      return NextResponse.json(
        {
          error:
            "Confluence is not configured. Set the CONFLUENCE_* env vars first.",
        },
        { status: 503 }
      )
    }

    let body: PublishBody
    try {
      body = (await request.json()) as PublishBody
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }
    const parentId = (body.parentId || "").trim()
    if (!parentId) {
      return NextResponse.json(
        { error: "Pick a parent page to publish under." },
        { status: 400 }
      )
    }

    let artifact
    try {
      artifact = await getDsd(id, artifactId)
    } catch {
      return NextResponse.json({ error: "DSD not found" }, { status: 404 })
    }
    if (!artifact.markdown || !artifact.markdown.trim()) {
      return NextResponse.json(
        { error: "This DSD is empty — nothing to publish." },
        { status: 400 }
      )
    }

    try {
      const images = Array.isArray(body.images) ? body.images : []
      const imageFiles = new Set(images.map((im) => im.filename))
      const storageBody = await buildDsdPageBody(artifact, imageFiles)
      const existingPageId = artifact.confluence?.pageId

      let pageRef
      let action: "created" | "updated"

      if (existingPageId) {
        try {
          const current = await getPage(existingPageId)
          pageRef = await updatePage({
            pageId: existingPageId,
            title: current.title, // keep the title stable across re-publishes
            storageBody,
            currentVersion: current.version.number,
            parentId,
            message: `synced from arch-tool: DSD ${id}/${artifactId}`,
          })
          action = "updated"
        } catch (err) {
          // Page deleted in Confluence — fall through to a fresh create.
          getLogger().warn(
            `DSD Confluence page ${existingPageId} not accessible, recreating`,
            { err: err instanceof Error ? err.message : String(err) }
          )
          pageRef = await createPage({
            title: await uniqueTitle(artifact.title || `DSD — ${id}`, artifactId),
            storageBody,
            parentId,
          })
          action = "created"
        }
      } else {
        pageRef = await createPage({
          title: await uniqueTitle(artifact.title || `DSD — ${id}`, artifactId),
          storageBody,
          parentId,
        })
        action = "created"
      }

      // Upload the rendered diagram PNGs as page attachments so the
      // <ac:image> refs resolve (best-effort: a failed image must not fail
      // the whole publish — the page text is already there).
      let uploaded = 0
      for (const im of images) {
        try {
          const contentType = im.filename.toLowerCase().endsWith(".svg")
            ? "image/svg+xml"
            : "image/png"
          await uploadAttachment(pageRef.id, im.filename, contentType, Buffer.from(im.base64, "base64"))
          uploaded += 1
        } catch (e) {
          getLogger().warn("DSD diagram attachment upload failed", {
            id,
            artifactId,
            filename: im.filename,
            err: e instanceof Error ? e.message : String(e),
          })
        }
      }
      if (images.length) {
        getLogger().info("DSD diagrams attached", { id, artifactId, uploaded, total: images.length })
      }

      await setDsdConfluence(id, artifactId, {
        pageId: pageRef.id,
        pageUrl: pageRef.fullUrl,
        parentId,
        parentTitle: body.parentTitle,
        spaceId: pageRef.spaceId,
        version: pageRef.version.number,
        publishedAt: new Date().toISOString(),
      })

      return NextResponse.json({
        action,
        pageId: pageRef.id,
        pageUrl: pageRef.fullUrl,
        parentId,
        parentTitle: body.parentTitle,
      })
    } catch (error: unknown) {
      const status =
        error && typeof error === "object" && "status" in error
          ? (error as { status: number }).status
          : 500
      const message = error instanceof Error ? error.message : "Unknown error"
      getLogger().error("Failed to publish DSD to Confluence", {
        id,
        artifactId,
        err: message,
      })
      return NextResponse.json(
        { error: `Failed to publish: ${message}` },
        { status: status >= 400 && status < 600 ? status : 500 }
      )
    }
  })
}

// Confluence page titles must be unique within a space. On a first
// publish, if the chosen title already exists (a different page), append a
// short discriminator derived from the artifact id.
async function uniqueTitle(base: string, artifactId: string): Promise<string> {
  const title = base.trim() || "DSD"
  try {
    const existing = await findPageByTitleInSpace(title)
    if (!existing) return title
  } catch {
    return title
  }
  const short = artifactId.replace(/[^A-Za-z0-9]/g, "").slice(-6) || "rev"
  return `${title} (${short})`
}

async function buildDsdPageBody(artifact: DsdArtifact, mermaidImageFiles?: Set<string>): Promise<string> {
  // Make clear this is analyst-authored work via Team Repository (a person
  // in the loop using AI assistance), not an autonomous bot output. No
  // link back to the tool: it runs locally inside the corp network, so a
  // public/test URL would be misleading.
  const header =
    `<ac:structured-macro ac:name="info">` +
    `<ac:rich-text-body>` +
    `<p>Prepared by an analyst in <strong>Team Repository</strong> with AI assistance.</p>` +
    buildCredit(artifact) +
    `</ac:rich-text-body>` +
    `</ac:structured-macro>`
  const narrative = await markdownToStorage(artifact.markdown, { mermaidImageFiles })
  const footer = `<hr/><p style="color:#9ca3af;font-size:11px;">Team Repository · DSD ${escapeXml(artifact.solutionId)}</p>`
  return [header, narrative, footer].join("\n")
}

// A small, de-emphasised line crediting which AI agents (and versions)
// assisted — overview-level info, intentionally secondary to the analyst.
function buildCredit(artifact: DsdArtifact): string {
  const bits: string[] = []
  if (artifact.mode === "team") bits.push("Agent-team mode")
  else if (artifact.mode === "quick") bits.push("Quick mode")

  const agents = Object.entries(artifact.agentVersions || {}).map(
    ([id, v]) => `${id} v${v}`
  )
  if (agents.length > 0) bits.push(`AI contributors: ${agents.join(", ")}`)
  if (artifact.model) bits.push(artifact.model)
  bits.push(`published ${new Date().toISOString().slice(0, 10)}`)

  return `<p style="color:#6b7280;font-size:12px;"><em>${escapeXml(bits.join(" · "))}</em></p>`
}
