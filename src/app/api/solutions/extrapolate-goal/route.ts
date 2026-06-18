// POST /api/solutions/extrapolate-goal
//
// Given the text of an uploaded requirement document (BRD), the LLM
// distills a single concise solution goal — one outcome-focused
// sentence. Used by the solution composer to pre-fill an EMPTY goal
// field after a document upload; the composer never calls this when the
// analyst has already written a goal, so this endpoint is purely a
// best-effort assist and its caller treats failure as a no-op.
//
// Mirrors the ai-compose route's plumbing (getLLM, rate limit, route
// context, prompt sanitising) but is deliberately tiny.

import { NextResponse } from "next/server"
import { getLLM, isLLMConfigured, LLM_DISABLED_MESSAGE } from "@/lib/llm"
import { checkRateLimit } from "@/lib/rate-limit"
import { sanitizeForPrompt } from "@/lib/validate"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

interface Body {
  text?: string
}

// Cap the document text fed to the model — a goal is a one-liner, so the
// opening of the requirement is more than enough signal and this keeps
// the request cheap.
const MAX_INPUT_CHARS = 12000

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

    let body: Body
    try {
      body = (await request.json()) as Body
    } catch {
      return NextResponse.json({ error: "Body must be JSON." }, { status: 400 })
    }
    const text = (body.text || "").trim()
    if (text === "") {
      return NextResponse.json({ error: "No document text provided." }, { status: 400 })
    }

    try {
      const llm = await getLLM()
      const prompt = buildPrompt(sanitizeForPrompt(text.slice(0, MAX_INPUT_CHARS)))
      const raw = await llm.complete({ prompt, maxTokens: 200 })
      const goal = cleanGoal(raw)
      if (!goal) {
        return NextResponse.json({ error: "Could not derive a goal." }, { status: 422 })
      }
      getLogger().info("Solution goal extrapolated", { length: goal.length })
      return NextResponse.json({ goal })
    } catch (error) {
      getLogger().error("Goal extrapolation failed", {
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json(
        { error: `Goal extrapolation failed: ${error instanceof Error ? error.message : "Unknown error"}` },
        { status: 500 }
      )
    }
  })
}

// Strip code fences / quotes / a leading "Goal:" label the model may add,
// collapse whitespace, and keep it to a single sentence-ish line.
function cleanGoal(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^```[a-z]*\s*/i, "").replace(/```$/i, "").trim()
  s = s.replace(/^(goal|objective)\s*[:\-]\s*/i, "")
  s = s.replace(/^["'“”]+|["'“”]+$/g, "")
  s = s.replace(/\s+/g, " ").trim()
  return s.slice(0, 240)
}

function buildPrompt(text: string): string {
  return `You are a solution architect. Read the requirement document below and write the solution's GOAL: a single concise, outcome-focused sentence (max ~20 words) stating what the solution should achieve for the business. Do not describe how it is built, list features, or add commentary.

Requirement document:
${text}

Return ONLY the goal sentence, with no label, quotes, or code fence.`
}
