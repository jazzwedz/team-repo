// GET  /api/solutions   — list all solutions
// POST /api/solutions   — create a solution (basic; the wizard's
//                         create-with-gap-components flow is layered on
//                         in a later phase).

import { NextResponse } from "next/server"
import { listSolutions, saveSolution } from "@/lib/solutions"
import { listComponents, saveComponent } from "@/lib/github"
import { isValidName } from "@/lib/validate"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"
import type { Solution, Component } from "@/lib/types"

export const dynamic = "force-dynamic"

interface CreateBody {
  solution: Solution
  /** Draft components to create first (gap fills from the wizard). */
  newComponents?: Component[]
}

export async function GET(request: Request) {
  return withRouteContext(request, async () => {
    try {
      const solutions = await listSolutions()
      return NextResponse.json(solutions)
    } catch (error) {
      getLogger().error("Failed to list solutions", {
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json({ error: "Failed to fetch solutions" }, { status: 500 })
    }
  })
}

export async function POST(request: Request) {
  return withRouteContext(request, async () => {
    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return NextResponse.json({ error: "Body must be JSON." }, { status: 400 })
    }

    // Accept either a bare Solution (back-compat) or { solution, newComponents }.
    const body: CreateBody =
      raw && typeof raw === "object" && "solution" in (raw as object)
        ? (raw as CreateBody)
        : { solution: raw as Solution }

    const solution = body.solution
    if (!solution || !solution.id || !isValidName(solution.id)) {
      return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
    }
    if (!solution.name) {
      return NextResponse.json({ error: "Missing required field: name" }, { status: 400 })
    }
    if (!solution.status) solution.status = "draft"
    if (!solution.description) solution.description = {}

    // Friendly id-collision check so the analyst gets a clear reason
    // instead of a raw git "file already exists" error.
    try {
      const existingSolutions = await listSolutions()
      if (existingSolutions.some((s) => s.id === solution.id)) {
        return NextResponse.json(
          {
            error: `A solution named "${solution.name}" (id "${solution.id}") already exists. Choose a different name, or open and edit the existing one.`,
          },
          { status: 409 }
        )
      }
    } catch {
      // If the list fails we fall through and let the save attempt surface
      // any real error — better than blocking on a transient read failure.
    }

    const created: string[] = []
    const skipped: string[] = []
    try {
      // Create gap draft components first (skip ids that already exist).
      const newComponents = body.newComponents || []
      if (newComponents.length > 0) {
        const existing = new Set((await listComponents()).map((c) => c.id))
        for (const comp of newComponents) {
          if (!comp.id || !isValidName(comp.id) || !comp.name) {
            skipped.push(comp.id || "(invalid)")
            continue
          }
          if (existing.has(comp.id)) {
            skipped.push(comp.id) // already in catalog — reference it as-is
            continue
          }
          if (!comp.status) comp.status = "draft"
          if (!comp.type) comp.type = "service"
          await saveComponent(comp)
          existing.add(comp.id)
          created.push(comp.id)
        }
      }

      await saveSolution(solution)
      getLogger().info("Solution created", {
        id: solution.id,
        componentsCreated: created.length,
        componentsSkipped: skipped.length,
      })
      return NextResponse.json({
        success: true,
        id: solution.id,
        componentsCreated: created,
        componentsSkipped: skipped,
      })
    } catch (error) {
      getLogger().error("Failed to create solution", {
        id: solution.id,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json(
        {
          error: `Failed to create solution: ${error instanceof Error ? error.message : "Unknown error"}`,
          componentsCreated: created,
        },
        { status: 500 }
      )
    }
  })
}
