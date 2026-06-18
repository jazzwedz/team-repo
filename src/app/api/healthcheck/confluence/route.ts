import { NextResponse } from "next/server"
import {
  getConfluenceEdition,
  getConfluenceProvider,
  missingConfluenceEnvVars,
} from "@/lib/confluence/index"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

// POST — verbose live-probe of the configured Confluence edition.
// Returns the sanitized self-description, a four-step probe trace, and
// (when nothing is configured) the list of env vars that need to be set.
export async function POST(request: Request) {
  return withRouteContext(request, doPost)
}

async function doPost() {
  const edition = getConfluenceEdition()
  const missing = missingConfluenceEnvVars()
  getLogger().adminAction("healthcheck.confluence", { edition })

  if (missing.length > 0) {
    return NextResponse.json({
      ok: false,
      configured: false,
      edition,
      missingEnv: missing,
      error: `Not configured — set: ${missing.join(", ")}.`,
    })
  }

  try {
    const confluence = getConfluenceProvider()
    const describe = confluence.describe()
    const trace = await confluence.probe()
    return NextResponse.json({
      ok: trace.ok,
      configured: true,
      edition,
      describe,
      trace,
      elapsedMs: trace.totalMs,
    })
  } catch (error: unknown) {
    return NextResponse.json({
      ok: false,
      configured: true,
      edition,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
