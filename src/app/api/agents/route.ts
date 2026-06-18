// GET /api/agents — list the DSD agents (writer / critic / coach).

import { NextResponse } from "next/server"
import { listAgents } from "@/lib/agents"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return withRouteContext(request, async () => {
    try {
      const agents = await listAgents()
      return NextResponse.json(agents)
    } catch (error) {
      getLogger().error("Failed to list agents", {
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json({ error: "Failed to list agents" }, { status: 500 })
    }
  })
}
