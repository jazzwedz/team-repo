// GET / PUT / DELETE /api/solutions/[id]

import { NextResponse } from "next/server"
import { getSolution, saveSolution, deleteSolution } from "@/lib/solutions"
import { isValidName } from "@/lib/validate"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRouteContext(request, async () => {
    try {
      const { id } = await params
      if (!isValidName(id)) {
        return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
      }
      const solution = await getSolution(id)
      return NextResponse.json(solution)
    } catch (error) {
      getLogger().error("Failed to get solution", {
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json({ error: "Solution not found" }, { status: 404 })
    }
  })
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRouteContext(request, async () => {
    try {
      const { id } = await params
      if (!isValidName(id)) {
        return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
      }
      const { sha, ...solution } = await request.json()
      if (solution.id !== id) {
        return NextResponse.json({ error: "Solution id mismatch" }, { status: 400 })
      }
      await saveSolution(solution, sha)
      return NextResponse.json({ success: true })
    } catch (error) {
      getLogger().error("Failed to update solution", {
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json({ error: "Failed to update solution" }, { status: 500 })
    }
  })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRouteContext(request, async () => {
    try {
      const { id } = await params
      if (!isValidName(id)) {
        return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
      }
      const { sha } = await request.json()
      await deleteSolution(id, sha)
      return NextResponse.json({ success: true })
    } catch (error) {
      getLogger().error("Failed to delete solution", {
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json({ error: "Failed to delete solution" }, { status: 500 })
    }
  })
}
