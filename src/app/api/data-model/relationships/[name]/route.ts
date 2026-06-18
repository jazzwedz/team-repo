// GET /api/data-model/relationships/[name]
//
// Server-side proxy that fetches relationships for a single entity
// from the configured data model registry.

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
      const relationships = await dm.getRelationships(trimmed)
      return NextResponse.json({ ok: true, relationships })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      getLogger().error("data-model relationships fetch failed", { entity: trimmed, err: message })
      return NextResponse.json(
        { ok: false, error: "fetch-failed", message },
        { status: 502 }
      )
    }
  })
}
