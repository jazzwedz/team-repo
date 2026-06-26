// GET /api/app-config  → effective application settings (secrets masked)
// PUT /api/app-config  → save overrides { values, clear }
//
// Saved to a local, gitignored file; precedence is saved ?? env. Secret
// values are never returned to the browser — only whether a value is set.

import { NextResponse } from "next/server"
import {
  getEffectiveConfig,
  saveConfig,
  CONFIG_GROUPS,
  type SaveConfigInput,
} from "@/lib/app-config"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return withRouteContext(request, async () => {
    try {
      return NextResponse.json({ groups: CONFIG_GROUPS, fields: getEffectiveConfig() })
    } catch (error) {
      getLogger().error("Failed to load app config", {
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json({ error: "Failed to load settings" }, { status: 500 })
    }
  })
}

export async function PUT(request: Request) {
  return withRouteContext(request, async () => {
    let body: SaveConfigInput
    try {
      body = (await request.json()) as SaveConfigInput
    } catch {
      return NextResponse.json({ error: "Body must be JSON." }, { status: 400 })
    }
    try {
      saveConfig({
        values: body.values && typeof body.values === "object" ? body.values : {},
        clear: Array.isArray(body.clear) ? body.clear.filter((k) => typeof k === "string") : [],
      })
      // Don't log values — they include secrets.
      getLogger().info("Application settings saved", {
        changed: Object.keys(body.values || {}).length,
        cleared: (body.clear || []).length,
      })
      return NextResponse.json({ ok: true, groups: CONFIG_GROUPS, fields: getEffectiveConfig() })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      getLogger().error("Failed to save app config", { err: message })
      return NextResponse.json({ error: `Failed to save: ${message}` }, { status: 500 })
    }
  })
}
