import { NextResponse } from "next/server"
import {
  getDataModel,
  isDataModelConfigured,
  missingDataModelEnvVars,
  DATA_MODEL_DISABLED_MESSAGE,
} from "@/lib/data-model"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

// POST — verbose live-probe of the configured data model registry.
// Mirrors the LLM / Git / Confluence healthcheck shape so the Settings
// page renders the trace the same way: describe block + four-step
// probe (DNS / request / response / classify), with a second phase
// when the integration uses OAuth.
export async function POST(request: Request) {
  return withRouteContext(request, async () => {
    const missing = missingDataModelEnvVars()
    if (!isDataModelConfigured()) {
      return NextResponse.json({
        ok: false,
        configured: false,
        missingEnv: missing,
        error:
          missing.length > 0
            ? `Not configured — set: ${missing.join(", ")}.`
            : DATA_MODEL_DISABLED_MESSAGE,
      })
    }
    try {
      const dm = getDataModel()
      const describe = dm.describe()
      const trace = await dm.probe()
      getLogger().adminAction("healthcheck.data-model", {
        zone: dm.zone,
      })
      return NextResponse.json({
        ok: trace.ok,
        configured: true,
        zone: dm.zone,
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
  })
}
