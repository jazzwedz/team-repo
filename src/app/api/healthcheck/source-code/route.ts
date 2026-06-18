// POST — verbose live-probe of the source-code repository connection
// (read-only Azure DevOps). Returns the sanitized self-description, the
// four-step probe trace, and (when nothing is configured) the env vars
// that need to be set. Mirrors the Git/Confluence health checks.

import { NextResponse } from "next/server"
import { getSourceGit, missingSourceEnvVars } from "@/lib/source-git"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  return withRouteContext(request, doPost)
}

async function doPost() {
  const missing = missingSourceEnvVars()
  getLogger().adminAction("healthcheck.source-code", {})

  if (missing.length > 0) {
    return NextResponse.json({
      ok: false,
      configured: false,
      missingEnv: missing,
      error: `Not configured — set: ${missing.join(", ")}.`,
    })
  }

  try {
    const git = getSourceGit()
    const describe = git.describe()
    const trace = await git.probe()
    return NextResponse.json({
      ok: trace.ok,
      configured: true,
      provider: describe.provider,
      branch: describe.branch,
      describe,
      trace,
      elapsedMs: trace.totalMs,
    })
  } catch (error: unknown) {
    return NextResponse.json({
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
