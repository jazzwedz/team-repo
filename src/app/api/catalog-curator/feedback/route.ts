// POST /api/catalog-curator/feedback
//
// Record 👍/👎 feedback on a Catalog Curator proposal. Appended to the
// curator feedback store; the coach pass later turns recurring feedback
// into "lessons" for the catalog-curator agent.

import { NextResponse } from "next/server"
import { appendCuratorFeedback } from "@/lib/catalog-curator"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

interface Body {
  rating?: "up" | "down"
  proposalSummary?: string
  comment?: string
  by?: string
}

export async function POST(request: Request) {
  return withRouteContext(request, async () => {
    let body: Body
    try {
      body = (await request.json()) as Body
    } catch {
      return NextResponse.json({ error: "Body must be JSON." }, { status: 400 })
    }
    if (body.rating !== "up" && body.rating !== "down") {
      return NextResponse.json({ error: "`rating` must be 'up' or 'down'." }, { status: 400 })
    }

    try {
      await appendCuratorFeedback({
        id: crypto.randomUUID(),
        rating: body.rating,
        proposalSummary: typeof body.proposalSummary === "string" ? body.proposalSummary.slice(0, 200) : undefined,
        comment: typeof body.comment === "string" ? body.comment.slice(0, 1000) : undefined,
        by: typeof body.by === "string" ? body.by : undefined,
        at: new Date().toISOString(),
        resolved: false,
      })
      return NextResponse.json({ success: true })
    } catch (error) {
      getLogger().error("Failed to record curator feedback", {
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json({ error: "Failed to record feedback." }, { status: 500 })
    }
  })
}
