// Edit lock — acquire (POST), inspect (GET), release (DELETE).
//
// Only meaningful when GIT_PROVIDER=filesystem (see src/lib/locks/).
// For other providers, every endpoint returns { supported: false } so
// the edit page can degrade gracefully (skip the lock flow entirely
// and rely on the hash-based concurrency check at save time).

import { NextResponse } from "next/server"
import { getLockProvider } from "@/lib/locks"
import { getCurrentUser } from "@/lib/current-user"
import { isValidName } from "@/lib/validate"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRouteContext(request, async () => {
    const { id } = await params
    if (!isValidName(id)) {
      return NextResponse.json({ ok: false, error: "invalid-id" }, { status: 400 })
    }
    const lock = getLockProvider()
    if (!lock.supported) {
      return NextResponse.json({ ok: true, supported: false })
    }
    const user = getCurrentUser(request)
    const result = await lock.acquire(id, user)
    if (result.ok) {
      getLogger().adminAction("lock.acquire", { componentId: id })
      return NextResponse.json({ ok: true, supported: true, lock: result.lock })
    }
    if (result.reason === "held-by-other") {
      getLogger().adminAction("lock.denied", {
        componentId: id,
        currentEditor: result.current.user,
      })
      return NextResponse.json(
        { ok: false, supported: true, reason: "held-by-other", current: result.current },
        { status: 409 }
      )
    }
    return NextResponse.json({ ok: true, supported: false })
  })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!isValidName(id)) {
    return NextResponse.json({ ok: false, error: "invalid-id" }, { status: 400 })
  }
  const lock = getLockProvider()
  if (!lock.supported) {
    return NextResponse.json({ supported: false, inUse: false })
  }
  const user = getCurrentUser(request)
  const status = await lock.status(id, user)
  return NextResponse.json({ supported: true, ...status })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRouteContext(request, async () => {
    const { id } = await params
    if (!isValidName(id)) {
      return NextResponse.json({ ok: false, error: "invalid-id" }, { status: 400 })
    }
    const lock = getLockProvider()
    if (!lock.supported) {
      return NextResponse.json({ supported: false, released: false })
    }
    const user = getCurrentUser(request)
    const result = await lock.release(id, user)
    if (result.released) {
      getLogger().adminAction("lock.release", { componentId: id })
    }
    return NextResponse.json({ supported: true, ...result })
  })
}
