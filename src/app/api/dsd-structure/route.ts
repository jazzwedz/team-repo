// GET /api/dsd-structure  → the editable DSD output structure (+ sha)
// PUT /api/dsd-structure  → save an edited structure { structure, sha }
//
// The structure defines WHAT chapters the DSD has (titles + guidance), which
// writer owns each, and the critics' focus. Generation reads it instead of
// the hard-coded default once an analyst has saved one.

import { NextResponse } from "next/server"
import {
  getDsdStructureWithSha,
  saveDsdStructure,
} from "@/lib/dsd-structure-store"
import type { DsdStructure } from "@/lib/dsd-sections"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return withRouteContext(request, async () => {
    try {
      const { structure, sha } = await getDsdStructureWithSha()
      return NextResponse.json({ structure, sha })
    } catch (error) {
      getLogger().error("Failed to load DSD structure", {
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json({ error: "Failed to load DSD structure" }, { status: 500 })
    }
  })
}

export async function PUT(request: Request) {
  return withRouteContext(request, async () => {
    let body: { structure?: DsdStructure; sha?: string }
    try {
      body = (await request.json()) as { structure?: DsdStructure; sha?: string }
    } catch {
      return NextResponse.json({ error: "Body must be JSON." }, { status: 400 })
    }
    if (!body.structure || typeof body.structure !== "object") {
      return NextResponse.json({ error: "Missing 'structure'." }, { status: 400 })
    }
    try {
      await saveDsdStructure(body.structure, body.sha)
      const fresh = await getDsdStructureWithSha()
      return NextResponse.json({ ok: true, ...fresh })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      getLogger().error("Failed to save DSD structure", { err: message })
      return NextResponse.json({ error: `Failed to save: ${message}` }, { status: 500 })
    }
  })
}
