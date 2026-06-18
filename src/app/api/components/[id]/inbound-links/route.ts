import { NextResponse } from "next/server"
import { listComponents } from "@/lib/github"
import { isValidName } from "@/lib/validate"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"
import type { ComponentLink } from "@/lib/types"

export const dynamic = "force-dynamic"

// GET /api/components/[id]/inbound-links
//
// v2 backlink endpoint — supersedes inbound-interfaces and
// inbound-relationships. Scans every other component's `links[]`
// looking for entries whose `target` equals this id, and returns one
// row per match so the detail page can render the inverse direction
// inline with the outbound links list.

interface InboundLinkRef {
  id: string
  name: string
  type: string
  link: ComponentLink
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRouteContext(request, async () => {
    try {
      const { id } = await params
      if (!isValidName(id)) {
        return NextResponse.json({ error: "Invalid component ID" }, { status: 400 })
      }

      const all = await listComponents()
      const refs: InboundLinkRef[] = []
      for (const c of all) {
        if (c.id === id) continue
        for (const link of c.links || []) {
          if (link.target === id) {
            refs.push({ id: c.id, name: c.name, type: c.type, link })
          }
        }
      }

      return NextResponse.json(refs)
    } catch (error) {
      getLogger().error("Failed to compute inbound links", {
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json(
        { error: "Failed to fetch inbound links" },
        { status: 500 }
      )
    }
  })
}
