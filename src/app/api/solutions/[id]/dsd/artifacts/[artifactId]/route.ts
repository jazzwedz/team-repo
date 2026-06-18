// GET / DELETE /api/solutions/[id]/dsd/artifacts/[artifactId]

import { NextResponse } from "next/server"
import { getDsd, deleteDsd, updateDsdMarkdown, renameDsd } from "@/lib/dsd-store"
import { isValidName } from "@/lib/validate"
import { getCurrentUser } from "@/lib/current-user"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  return withRouteContext(request, async () => {
    const { id, artifactId } = await params
    if (!isValidName(id)) {
      return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
    }
    try {
      const artifact = await getDsd(id, artifactId)
      return NextResponse.json(artifact)
    } catch {
      return NextResponse.json({ error: "DSD not found" }, { status: 404 })
    }
  })
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  return withRouteContext(request, async () => {
    const { id, artifactId } = await params
    if (!isValidName(id)) {
      return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
    }
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
      if (hasTitle) await renameDsd(id, artifactId, body.title as string)
      if (hasMarkdown) await updateDsdMarkdown(id, artifactId, body.markdown as string, getCurrentUser(request))
      const artifact = await getDsd(id, artifactId)
      return NextResponse.json(artifact)
    } catch (error) {
      getLogger().error("Failed to save DSD edit", {
        id,
        artifactId,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json({ error: "Failed to save DSD" }, { status: 500 })
    }
  })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  return withRouteContext(request, async () => {
    const { id, artifactId } = await params
    if (!isValidName(id)) {
      return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
    }
    try {
      await deleteDsd(id, artifactId)
      return NextResponse.json({ success: true })
    } catch (error) {
      getLogger().error("Failed to delete DSD", {
        id,
        artifactId,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json({ error: "Failed to delete DSD" }, { status: 500 })
    }
  })
}
