"use client"

// Mount-once side-effect component that ships browser-side errors to
// the server logger. Hooks two events:
//
//   - window.onerror             uncaught JS errors
//   - unhandledrejection         rejected promises with no .catch
//
// React component crashes are caught by an Error Boundary at the
// layout level (see ClientErrorBoundary). The reporter de-dupes
// identical errors within a short window so a render loop cannot
// flood /api/client-log.

import { useEffect, useRef } from "react"

const DEDUPE_WINDOW_MS = 5_000

export function ClientErrorReporter() {
  const recent = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    if (typeof window === "undefined") return

    const shouldSend = (key: string): boolean => {
      const now = Date.now()
      const last = recent.current.get(key)
      if (last && now - last < DEDUPE_WINDOW_MS) return false
      recent.current.set(key, now)
      // Light cleanup so the Map doesn't grow forever.
      if (recent.current.size > 200) {
        const cutoff = now - DEDUPE_WINDOW_MS * 4
        for (const [k, v] of recent.current) {
          if (v < cutoff) recent.current.delete(k)
        }
      }
      return true
    }

    const send = (payload: Record<string, unknown>) => {
      try {
        fetch("/api/client-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(() => {})
      } catch {
        // ignore — never let the reporter itself become a new error
      }
    }

    const onError = (ev: ErrorEvent) => {
      const key = `error|${ev.message}|${ev.filename}:${ev.lineno}:${ev.colno}`
      if (!shouldSend(key)) return
      send({
        level: "error",
        msg: ev.message || "(no message)",
        stack: ev.error?.stack,
        url: typeof window !== "undefined" ? window.location.href : undefined,
        meta: {
          filename: ev.filename,
          lineno: ev.lineno,
          colno: ev.colno,
        },
      })
    }

    const onRejection = (ev: PromiseRejectionEvent) => {
      const reason = ev.reason
      const message =
        reason instanceof Error ? reason.message : String(reason || "(no reason)")
      const stack = reason instanceof Error ? reason.stack : undefined
      const key = `rejection|${message}`
      if (!shouldSend(key)) return
      send({
        level: "error",
        msg: `Unhandled promise rejection: ${message}`,
        stack,
        url: typeof window !== "undefined" ? window.location.href : undefined,
      })
    }

    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onRejection)
    return () => {
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onRejection)
    }
  }, [])

  return null
}
