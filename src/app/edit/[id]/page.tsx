"use client"

import { useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ComponentForm } from "@/components/ComponentForm"
import { ArrowLeft, Lock, AlertTriangle, RefreshCw, Save, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import type { ComponentWithSha } from "@/lib/types"

// Heartbeat cadence — refresh the lock TTL every 5 minutes while this
// page is mounted. The server-side TTL is 10 minutes so a single missed
// heartbeat does not yet hand the lock to someone else.
const HEARTBEAT_MS = 5 * 60 * 1000

interface LockInfo {
  user: string
  acquiredAt: string
  expiresAt: string
}

interface LockResponse {
  supported?: boolean
  ok?: boolean
  lock?: LockInfo
  current?: LockInfo
  reason?: string
}

// Parse a lock endpoint response without ever throwing on an empty or
// non-JSON body. A 500 (or an auth/proxy interception) returns an empty
// body; calling res.json() on it throws "Unexpected end of JSON input",
// which used to surface as a cryptic red banner and block editing.
// Returning null here lets callers degrade gracefully instead.
async function readLockJson(res: Response): Promise<LockResponse | null> {
  try {
    const text = await res.text()
    if (!text.trim()) return null
    return JSON.parse(text) as LockResponse
  } catch {
    return null
  }
}

type LockState =
  | { kind: "checking" }
  | { kind: "unsupported" }
  | { kind: "owned"; lock: LockInfo }
  | { kind: "held-by-other"; current: LockInfo }
  | { kind: "error"; message: string }

export default function EditComponentPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [component, setComponent] = useState<ComponentWithSha | null>(null)
  const [loading, setLoading] = useState(true)
  const [lockState, setLockState] = useState<LockState>({ kind: "checking" })
  const [formSaving, setFormSaving] = useState(false)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ownedRef = useRef(false)

  // Load component data.
  useEffect(() => {
    fetch(`/api/components/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found")
        return r.json()
      })
      .then(setComponent)
      .catch(() => router.push("/"))
      .finally(() => setLoading(false))
  }, [id, router])

  // Acquire lock on mount, release on unmount, heartbeat in between.
  useEffect(() => {
    if (!id) return
    let cancelled = false

    async function acquire() {
      try {
        const res = await fetch(`/api/components/${id}/lock`, { method: "POST" })
        const data = await readLockJson(res)
        if (cancelled) return
        // Empty / non-JSON body (e.g. a 500) — the lock flow can't run.
        // Locks are advisory; degrade to the unsupported path so the
        // analyst can still edit and the save-time hash check guards us.
        if (!data) {
          setLockState({ kind: "unsupported" })
          return
        }
        if (data.supported === false) {
          setLockState({ kind: "unsupported" })
          return
        }
        if (data.ok && data.lock) {
          ownedRef.current = true
          setLockState({ kind: "owned", lock: data.lock })
          heartbeatRef.current = setInterval(refreshLock, HEARTBEAT_MS)
          return
        }
        if (res.status === 409 && data.current) {
          ownedRef.current = false
          setLockState({ kind: "held-by-other", current: data.current })
          return
        }
        setLockState({ kind: "error", message: "Could not acquire edit lock." })
      } catch (e) {
        if (cancelled) return
        setLockState({
          kind: "error",
          message: e instanceof Error ? e.message : "Lock request failed.",
        })
      }
    }

    void acquire()

    return () => {
      cancelled = true
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current)
        heartbeatRef.current = null
      }
      // Best-effort release on navigate-away. Use keepalive so the
      // browser doesn't cancel the request as the page unloads.
      if (ownedRef.current) {
        fetch(`/api/components/${id}/lock`, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => {})
        ownedRef.current = false
      }
    }
    // We intentionally only run on id change; the helpers below close
    // over current state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function refreshLock() {
    if (!ownedRef.current) return
    try {
      const res = await fetch(`/api/components/${id}/lock/refresh`, {
        method: "POST",
      })
      const data = await readLockJson(res)
      // Empty / non-JSON body — keep the current owned state; the
      // server TTL will reconcile and the next save surfaces any conflict.
      if (!data) return
      if (data.supported === false) return
      if (data.ok && data.lock) {
        setLockState({ kind: "owned", lock: data.lock })
        return
      }
      if (res.status === 409 && data.current) {
        ownedRef.current = false
        if (heartbeatRef.current) clearInterval(heartbeatRef.current)
        setLockState({ kind: "held-by-other", current: data.current })
      }
    } catch {
      // Network blip — TTL will eventually expire on the server. The
      // next save attempt will surface the conflict.
    }
  }

  async function retryAcquire() {
    setLockState({ kind: "checking" })
    try {
      const res = await fetch(`/api/components/${id}/lock`, { method: "POST" })
      const data = await readLockJson(res)
      if (!data) {
        setLockState({ kind: "unsupported" })
        return
      }
      if (data.supported === false) {
        setLockState({ kind: "unsupported" })
        return
      }
      if (data.ok && data.lock) {
        ownedRef.current = true
        setLockState({ kind: "owned", lock: data.lock })
        if (!heartbeatRef.current) {
          heartbeatRef.current = setInterval(refreshLock, HEARTBEAT_MS)
        }
        return
      }
      if (res.status === 409 && data.current) {
        setLockState({ kind: "held-by-other", current: data.current })
        return
      }
      setLockState({ kind: "error", message: "Could not acquire edit lock." })
    } catch (e) {
      setLockState({
        kind: "error",
        message: e instanceof Error ? e.message : "Lock request failed.",
      })
    }
  }

  async function releaseLockManually() {
    if (!ownedRef.current) return
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
    ownedRef.current = false
    await fetch(`/api/components/${id}/lock`, { method: "DELETE" }).catch(() => {})
    router.push(`/component/${id}`)
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Loading component...
      </div>
    )
  }

  if (!component) return null

  const readOnly =
    lockState.kind === "held-by-other" ||
    lockState.kind === "checking" ||
    lockState.kind === "error"

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={`/component/${id}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold flex-1">Edit: {component.name}</h1>
        {lockState.kind === "owned" && (
          <Button
            variant="outline"
            size="sm"
            onClick={releaseLockManually}
            title="Release the edit lock and return to the component view"
          >
            <Lock className="h-3.5 w-3.5 mr-1" />
            Release lock
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(`/component/${id}`)}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          form="component-form"
          disabled={readOnly || formSaving}
        >
          {formSaving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Update Component
        </Button>
      </div>

      <LockBanner state={lockState} onRetry={retryAcquire} />

      <ComponentForm
        initialData={component}
        isEdit
        readOnly={readOnly}
        formId="component-form"
        onSavingChange={setFormSaving}
      />
    </div>
  )
}

function LockBanner({
  state,
  onRetry,
}: {
  state: LockState
  onRetry: () => void
}) {
  if (state.kind === "checking") {
    return (
      <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Checking edit lock...
      </div>
    )
  }
  if (state.kind === "unsupported") return null
  if (state.kind === "owned") {
    const expires = new Date(state.lock.expiresAt)
    return (
      <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900 flex items-center gap-2">
        <Lock className="h-3.5 w-3.5" />
        <span>
          You are editing this component. Lock auto-renews while this page is
          open; expires at <code className="font-mono">{expires.toLocaleTimeString()}</code> if your browser disconnects.
        </span>
      </div>
    )
  }
  if (state.kind === "held-by-other") {
    const since = new Date(state.current.acquiredAt)
    return (
      <div className="rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-orange-900 space-y-2">
        <div className="flex items-start gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-medium">
              <code className="font-mono">{state.current.user}</code> is editing
              this component since {since.toLocaleTimeString()}
            </div>
            <div className="text-xs mt-0.5">
              You can view the form below, but any edits you make here will not
              be saved. Try again once they release the lock or it expires.
            </div>
          </div>
        </div>
        <div>
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Try acquiring lock
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
      {state.message}
    </div>
  )
}
