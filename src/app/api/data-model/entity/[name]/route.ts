// GET /api/data-model/entity/[name]
//
// Server-side proxy that fetches one entity from the configured data
// model registry. The credentials stay in the server process — the
// browser only sees the parsed entity definition. Returns:
//
//   { ok: true, entity: { entity, attributes, version, zone } }
//   { ok: false, error: "...", message: "..." }
//
// 404 is treated as "entity not found" rather than a failure so the
// detail page can render a "no such entity" state.

import { NextResponse } from "next/server"
import {
  getDataModel,
  isDataModelConfigured,
  DATA_MODEL_DISABLED_MESSAGE,
} from "@/lib/data-model"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  return withRouteContext(request, async () => {
    const { name } = await params
    const trimmed = (name || "").trim()
    if (!trimmed) {
      return NextResponse.json(
        { ok: false, error: "invalid-name" },
        { status: 400 }
      )
    }
    if (!isDataModelConfigured()) {
      return NextResponse.json(
        { ok: false, error: "not-configured", message: DATA_MODEL_DISABLED_MESSAGE },
        { status: 503 }
      )
    }
    try {
      const dm = getDataModel()
      const entity = await dm.getEntity(trimmed)
      if (!entity) {
        return NextResponse.json(
          { ok: false, error: "not-found", message: `Entity "${trimmed}" was not found in zone "${dm.zone}".` },
          { status: 404 }
        )
      }
      return NextResponse.json({ ok: true, entity, zone: dm.zone })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      getLogger().error("data-model entity fetch failed", { entity: trimmed, err: message })
      return NextResponse.json(
        { ok: false, error: "fetch-failed", message },
        { status: 502 }
      )
    }
  })
}
