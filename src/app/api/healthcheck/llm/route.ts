import { NextResponse } from "next/server"
import {
  getLLM,
  getLLMProviderName,
  missingLLMEnvVars,
} from "@/lib/llm"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

// POST — verbose live-probe of the configured LLM provider. Returns:
//   - the sanitized connection self-description (URL, model, masked
//     credential hint)
//   - a four-step trace (DNS → request → response → classify) so the UI
//     can pinpoint exactly where a failing connection breaks
//   - the env-var list when nothing is configured at all
export async function POST(request: Request) {
  return withRouteContext(request, doPost)
}

async function doPost() {
  const provider = getLLMProviderName()
  const missing = missingLLMEnvVars()
  getLogger().adminAction("healthcheck.llm", { provider })

  if (missing.length > 0) {
    return NextResponse.json({
      ok: false,
      configured: false,
      provider,
      missingEnv: missing,
      error: `Not configured — set: ${missing.join(", ")}.`,
    })
  }

  try {
    const llm = await getLLM()
    const describe = llm.describe()
    const trace = await llm.probe()
    return NextResponse.json({
      ok: trace.ok,
      configured: true,
      provider,
      model: describe.model,
      describe,
      trace,
      elapsedMs: trace.totalMs,
    })
  } catch (error: unknown) {
    return NextResponse.json({
      ok: false,
      configured: true,
      provider,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
