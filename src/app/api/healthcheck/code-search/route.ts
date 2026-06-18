// POST — health-check probe of the ADO Code Search API (read-only).
// Confirms the search service is reachable and the PAT is authorized.
// Mirrors the other health checks; uses the same SRC_ADO_* connection,
// deriving the search host (almsearch on ADO Services) automatically.

import { NextResponse } from "next/server"
import { probeCodeSearch } from "@/lib/code-search"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  return withRouteContext(request, async () => {
    getLogger().adminAction("healthcheck.code-search", {})
    const probe = await probeCodeSearch()
    return NextResponse.json(probe)
  })
}
