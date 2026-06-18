// POST /api/catalog-curator/coach
//
// Curator coach pass. Reads analyst feedback on Curator proposals newer
// than the coach watermark and proposes an improved "lessons" block for
// the catalog-curator agent. Returns the proposal for approval; the
// analyst commits it through the normal POST /api/agents/apply
// (agentId: "catalog-curator", lessons). Advances the watermark so the
// next run only considers newer feedback.

import { NextResponse } from "next/server"
import { isLLMConfigured, LLM_DISABLED_MESSAGE, getLLM } from "@/lib/llm"
import { getAgent, agentInstruction } from "@/lib/agents"
import {
  getCuratorFeedback,
  getCuratorCoachWatermark,
  setCuratorCoachWatermark,
  buildCuratorCoachPrompt,
  parseCuratorCoachProposal,
} from "@/lib/catalog-curator"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(request: Request) {
  return withRouteContext(request, async () => {
    if (!isLLMConfigured()) {
      return NextResponse.json({ error: LLM_DISABLED_MESSAGE }, { status: 503 })
    }

    try {
      const watermark = await getCuratorCoachWatermark()
      const all = await getCuratorFeedback()
      const recent = all.filter((f) => f.at > watermark)
      if (recent.length === 0) {
        return NextResponse.json({ proposal: null, feedbackConsidered: 0 })
      }

      const agent = await getAgent("catalog-curator")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const llm: any = await getLLM()
      const raw: string = await llm.complete({
        prompt: buildCuratorCoachPrompt(agentInstruction(agent), agent.lessons || "", recent.slice(-40).reverse()),
        maxTokens: 2000,
      })

      const proposal = parseCuratorCoachProposal(raw, recent.length)

      // Advance the watermark past this batch so we don't re-train on it.
      const newest = recent.reduce((m, f) => (f.at > m ? f.at : m), watermark)
      await setCuratorCoachWatermark(newest).catch(() => {})

      getLogger().info("Curator coach proposed", {
        feedbackConsidered: recent.length,
        hasProposal: !!proposal,
      })
      return NextResponse.json({ proposal, feedbackConsidered: recent.length })
    } catch (error) {
      getLogger().error("Curator coach failed", {
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json(
        { error: `Coach failed: ${error instanceof Error ? error.message : "Unknown error"}` },
        { status: 500 }
      )
    }
  })
}
