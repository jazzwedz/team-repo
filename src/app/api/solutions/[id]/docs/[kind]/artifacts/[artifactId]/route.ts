// GET / PUT / DELETE /api/solutions/[id]/docs/[kind]/artifacts/[artifactId]

import { NextResponse } from "next/server"
import { getDsd, deleteDsd, updateDsdMarkdown, renameDsd } from "@/lib/dsd-store"
import { isDocKind, DOC_KINDS } from "@/lib/doc-kinds"
import { isValidName } from "@/lib/validate"
import { getCurrentUser } from "@/lib/current-user"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

type P = { params: Promise<{ id: string; kind: string; artifactId: string }> }

export async function GET(request: Request, { params }: P) {
  return withRouteContext(request, async () => {
    const { id, kind, artifactId } = await params
    if (!isValidName(id)) return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
    if (!isDocKind(kind)) return NextResponse.json({ error: "Unknown document kind" }, { status: 404 })
    try {
      const artifact = await getDsd(id, artifactId, kind)
      return NextResponse.json(artifact)
    } catch {
      return NextResponse.json({ error: `${DOC_KINDS[kind].short} not found` }, { status: 404 })
    }
  })
}

export async function PUT(request: Request, { params }: P) {
  return withRouteContext(request, async () => {
    const { id, kind, artifactId } = await params
    if (!isValidName(id)) return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
    if (!isDocKind(kind)) return NextResponse.json({ error: "Unknown document kind" }, { status: 404 })
    let body: { markdown?: string; title?: string }
    try {
      body = (await request.json()) as { markdown?: string; title?: string }
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }
    const hasTitle = typeof body.title === "string" && body.title.trim().length > 0
    const hasMarkdown = typeof body.markdown === "string" && body.markdown.trim().length > 0
    if (!hasTitle && !hasMarkdown) {
      return NextResponse.json({ error: "Nothing to update — provide title or markdown" }, { status: 400 })
    }
    try {
      // Rename (metadata only) — distinct from a body edit, so renaming
      // does not flag the artifact as content-edited.
      if (hasTitle) await renameDsd(id, artifactId, body.title as string, kind)
      if (hasMarkdown) await updateDsdMarkdown(id, artifactId, body.markdown as string, getCurrentUser(request), kind)
      const artifact = await getDsd(id, artifactId, kind)
      return NextResponse.json(artifact)
    } catch (error) {
      getLogger().error(`Failed to save ${DOC_KINDS[kind].short} edit`, {
        id,
        artifactId,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json({ error: `Failed to save ${DOC_KINDS[kind].short}` }, { status: 500 })
    }
  })
}

export async function DELETE(request: Request, { params }: P) {
  return withRouteContext(request, async () => {
    const { id, kind, artifactId } = await params
    if (!isValidName(id)) return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
    if (!isDocKind(kind)) return NextResponse.json({ error: "Unknown document kind" }, { status: 404 })
    try {
      await deleteDsd(id, artifactId, kind)
      return NextResponse.json({ success: true })
    } catch (error) {
      getLogger().error(`Failed to delete ${DOC_KINDS[kind].short}`, {
        id,
        artifactId,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json({ error: `Failed to delete ${DOC_KINDS[kind].short}` }, { status: 500 })
    }
  })
}
