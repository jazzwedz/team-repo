// Heartbeat endpoint — the edit page calls this every few minutes while
// the form is open so the lock's TTL keeps extending. Refresh and
// acquire share the same code path on the server; the client uses the
// two endpoints to make its intent explicit.

import { NextResponse } from "next/server"
import { getLockProvider } from "@/lib/locks"
import { getCurrentUser } from "@/lib/current-user"
import { isValidName } from "@/lib/validate"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!isValidName(id)) {
    return NextResponse.json({ ok: false, error: "invalid-id" }, { status: 400 })
  }
  const lock = getLockProvider()
  if (!lock.supported) {
    return NextResponse.json({ ok: true, supported: false })
  }
  const user = getCurrentUser(request)
  const result = await lock.refresh(id, user)
  if (result.ok) {
    return NextResponse.json({ ok: true, supported: true, lock: result.lock })
  }
  if (result.reason === "held-by-other") {
    return NextResponse.json(
      { ok: false, supported: true, reason: "held-by-other", current: result.current },
      { status: 409 }
    )
  }
  return NextResponse.json({ ok: true, supported: false })
}
