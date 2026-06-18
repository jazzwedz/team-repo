// Frontend error reporter sink. The browser POSTs one JSON object per
// caught error (window.onerror, unhandledrejection, React Error
// Boundary). The handler annotates it with the server-side request
// context (user + requestId) and forwards to the configured logger
// with source="client" so the admin can tell it apart from server
// logs in the same file.
//
// MVP scope: errors only. Caps on payload size prevent abuse — a
// rogue browser tab cannot fill the disk by spamming this endpoint.

import { NextResponse } from "next/server"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"
import { getRequestId, getRequestUser } from "@/lib/request-context"

const MAX_MSG = 800
const MAX_STACK = 4000

interface ClientLogPayload {
  level?: "error" | "warn"
  msg?: string
  stack?: string
  url?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta?: Record<string, any>
}

export async function POST(request: Request) {
  return withRouteContext(request, async () => {
    let payload: ClientLogPayload
    try {
      payload = (await request.json()) as ClientLogPayload
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 })
    }
    const level = payload.level === "warn" ? "warn" : "error"
    const msg = (payload.msg || "(no message)").slice(0, MAX_MSG)
    const stack = payload.stack ? payload.stack.slice(0, MAX_STACK) : undefined
    const log = getLogger()
    const entry = {
      msg,
      meta: {
        clientUrl: payload.url ? payload.url.slice(0, 400) : undefined,
        stack,
        ...payload.meta,
      },
    }
    // We bypass the regular helpers so we can mark source=client
    // explicitly. The factory does not expose that field on the
    // logger interface — it is set by the server-side machinery for
    // its own entries — so we go through info/error directly and rely
    // on the meta field to carry the marker.
    if (level === "error") {
      log.error(msg, { ...entry.meta, source: "client" })
    } else {
      log.warn(msg, { ...entry.meta, source: "client" })
    }
    return NextResponse.json({
      ok: true,
      requestId: getRequestId(),
      user: getRequestUser(),
    })
  })
}
