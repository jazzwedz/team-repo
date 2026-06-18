// POST /api/solutions/[id]/promote-flows
//
// Writes the solution's `proposed` flows into the real `links[]` of the
// source member components, then flips those flows to `existing`. This is
// the "to-be becomes as-is" action — run after the solution is approved.
// Idempotent per link (skips a link that already exists on the source).

import { NextResponse } from "next/server"
import { getSolution, saveSolution } from "@/lib/solutions"
import { getComponent, saveComponent } from "@/lib/github"
import { isValidName } from "@/lib/validate"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"
import type { ComponentLink } from "@/lib/types"

export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRouteContext(request, async () => {
    const { id } = await params
    if (!isValidName(id)) {
      return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
    }

    try {
      const solution = await getSolution(id)
      const { sha: solSha, ...sol } = solution
      const flows = sol.flows || []
      const proposed = flows.filter((f) => f.status === "proposed")
      if (proposed.length === 0) {
        return NextResponse.json({ success: true, promoted: 0, skipped: [] })
      }

      // Group proposed flows by source component.
      const bySource = new Map<string, typeof proposed>()
      for (const f of proposed) {
        const arr = bySource.get(f.from) || []
        arr.push(f)
        bySource.set(f.from, arr)
      }

      let promoted = 0
      const skipped: string[] = []

      for (const [from, fs] of bySource) {
        let target
        try {
          target = await getComponent(from)
        } catch {
          skipped.push(from) // source not in catalog — leave its flows proposed
          continue
        }
        const { sha, ...comp } = target
        const links: ComponentLink[] = [...(comp.links || [])]
        const has = (l: ComponentLink) =>
          links.some(
            (x) =>
              x.target === l.target &&
              x.role === l.role &&
              (x.protocol ?? "") === (l.protocol ?? "")
          )
        for (const f of fs) {
          const link: ComponentLink = {
            target: f.to,
            role: f.role,
            ...(f.protocol ? { protocol: f.protocol } : {}),
            ...(f.description ? { description: f.description } : {}),
          }
          if (!has(link)) {
            links.push(link)
            promoted++
          }
        }
        comp.links = links
        await saveComponent(comp, sha)
      }

      // Flip promoted flows to existing (only those whose source succeeded).
      const skippedSet = new Set(skipped)
      for (const f of flows) {
        if (f.status === "proposed" && !skippedSet.has(f.from)) f.status = "existing"
      }
      sol.flows = flows
      await saveSolution(sol, solSha)

      getLogger().info("Solution flows promoted", { id, promoted, skipped: skipped.length })
      return NextResponse.json({ success: true, promoted, skipped })
    } catch (error) {
      getLogger().error("Failed to promote flows", {
        id,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json(
        { error: `Failed to promote flows: ${error instanceof Error ? error.message : "Unknown error"}` },
        { status: 500 }
      )
    }
  })
}
