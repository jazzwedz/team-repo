// POST /api/solutions/[id]/dsd/artifacts/[artifactId]/feedback
//
// Append analyst feedback to a saved DSD. This is the training signal the
// coach later uses to improve the writer / critic agents.

import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { addFeedback, type DsdFeedback } from "@/lib/dsd-store"
import { getCurrentUser } from "@/lib/current-user"
import { isValidName } from "@/lib/validate"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  return withRouteContext(request, async () => {
    const { id, artifactId } = await params
    if (!isValidName(id)) {
      return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
    }
    let body: { rating?: string; comment?: string; correctedText?: string; section?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Body must be JSON." }, { status: 400 })
    }
    if (body.rating !== "up" && body.rating !== "down") {
      return NextResponse.json({ error: "rating must be 'up' or 'down'." }, { status: 400 })
    }
    const feedback: DsdFeedback = {
      id: randomUUID(),
      resolved: false,
      rating: body.rating,
      comment: typeof body.comment === "string" && body.comment.trim() ? body.comment.trim() : undefined,
      correctedText:
        typeof body.correctedText === "string" && body.correctedText.trim()
          ? body.correctedText.trim()
          : undefined,
      section: typeof body.section === "string" && body.section.trim() ? body.section.trim() : undefined,
      at: new Date().toISOString(),
      by: getCurrentUser(request),
    }
    try {
      await addFeedback(id, artifactId, feedback)
      return NextResponse.json({ success: true })
    } catch (error) {
      getLogger().error("Failed to add DSD feedback", {
        id,
        artifactId,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 })
    }
  })
}
