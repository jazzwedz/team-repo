// POST /api/agents/coach/propose — coach proposes writer/critic prompt
// improvements from accumulated DSD feedback. Proposal only; nothing is
// written until the analyst approves via /api/agents/apply.

import { NextResponse } from "next/server"
import { proposeCoaching } from "@/lib/dsd-coach"
import { isLLMConfigured, LLM_DISABLED_MESSAGE } from "@/lib/llm"
import { checkRateLimit } from "@/lib/rate-limit"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(request: Request) {
  return withRouteContext(request, async () => {
    if (!isLLMConfigured()) {
      return NextResponse.json({ error: LLM_DISABLED_MESSAGE }, { status: 503 })
    }
    const clientIp = request.headers.get("x-forwarded-for") || "unknown"
    if (!checkRateLimit(clientIp)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a minute before trying again." },
        { status: 429 }
      )
    }
    try {
      const proposal = await proposeCoaching()
      return NextResponse.json(proposal)
    } catch (error) {
      getLogger().error("Coach propose failed", {
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json(
        { error: `Coaching failed: ${error instanceof Error ? error.message : "Unknown error"}` },
        { status: 500 }
      )
    }
  })
}
