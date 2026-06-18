// POST /api/agents/apply — commit an approved agent change (the approve
// step of the coach's propose → approve → commit training loop).
// Body: { agentId, system_prompt?, lessons? }

import { NextResponse } from "next/server"
import { getAgentWithSha, saveAgent, AGENT_IDS, type AgentId } from "@/lib/agents"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  return withRouteContext(request, async () => {
    let body: { agentId?: string; name?: string; system_prompt?: string; lessons?: string; avatar?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Body must be JSON." }, { status: 400 })
    }
    if (!body.agentId || !AGENT_IDS.includes(body.agentId as AgentId)) {
      return NextResponse.json({ error: "Invalid agentId" }, { status: 400 })
    }
    if (body.name !== undefined && (typeof body.name !== "string" || body.name.trim() === "")) {
      return NextResponse.json({ error: "name must be a non-empty string." }, { status: 400 })
    }
    try {
      const current = await getAgentWithSha(body.agentId as AgentId)
      const { sha, ...agent } = current
      if (typeof body.name === "string" && body.name.trim()) agent.name = body.name.trim()
      if (typeof body.system_prompt === "string" && body.system_prompt.trim())
        agent.system_prompt = body.system_prompt.trim()
      if (typeof body.lessons === "string") agent.lessons = body.lessons.trim()
      // Avatar override: a short emoji, or empty to reset to the default.
      if (typeof body.avatar === "string") agent.avatar = body.avatar.trim().slice(0, 16) || undefined
      await saveAgent(agent, sha)
      return NextResponse.json({ success: true, version: agent.version + 1 })
    } catch (error) {
      getLogger().error("Failed to apply agent change", {
        agentId: body.agentId,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json({ error: "Failed to apply agent change" }, { status: 500 })
    }
  })
}
