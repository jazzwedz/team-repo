import { NextResponse } from "next/server"
import { getDiagram, saveDiagram, deleteDiagram } from "@/lib/github"
import { isValidName } from "@/lib/validate"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  return withRouteContext(request, async () => {
    try {
      const { name } = await params
      if (!isValidName(name)) {
        return NextResponse.json({ error: "Invalid diagram name" }, { status: 400 })
      }
      const diagram = await getDiagram(name)
      return NextResponse.json(diagram)
    } catch (error) {
      getLogger().error("Failed to get diagram", { err: error instanceof Error ? error.message : "Unknown error" })
      return NextResponse.json(
        { error: "Diagram not found" },
        { status: 404 }
      )
    }
  })
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  return withRouteContext(request, async () => {
    try {
      const { name } = await params
      if (!isValidName(name)) {
        return NextResponse.json({ error: "Invalid diagram name" }, { status: 400 })
      }
      const { content, sha } = await request.json()
      await saveDiagram(name, content, sha)
      return NextResponse.json({ success: true })
    } catch (error) {
      getLogger().error("Failed to update diagram", { err: error instanceof Error ? error.message : "Unknown error" })
      return NextResponse.json(
        { error: "Failed to update diagram" },
        { status: 500 }
      )
    }
  })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  return withRouteContext(request, async () => {
    try {
      const { name } = await params
      if (!isValidName(name)) {
        return NextResponse.json({ error: "Invalid diagram name" }, { status: 400 })
      }
      const { sha } = await request.json()
      await deleteDiagram(name, sha)
      return NextResponse.json({ success: true })
    } catch (error) {
      getLogger().error("Failed to delete diagram", { err: error instanceof Error ? error.message : "Unknown error" })
      return NextResponse.json(
        { error: "Failed to delete diagram" },
        { status: 500 }
      )
    }
  })
}
