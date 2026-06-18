// GET /api/source-code/status
//
// Cheap "is the source-code repository connection configured?" check used
// by the component form's Source code card to decide whether to show the
// path editor. No network call — just env presence (unlike the Settings
// health check, which does a live probe).

import { NextResponse } from "next/server"
import { isSourceCodeConfigured } from "@/lib/source-git"
import { withRouteContext } from "@/lib/route-context"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return withRouteContext(request, async () => {
    return NextResponse.json({ configured: isSourceCodeConfigured() })
  })
}
