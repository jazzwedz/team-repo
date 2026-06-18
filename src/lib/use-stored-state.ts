"use client"

// React state hook backed by localStorage.
//
// Drop-in replacement for useState that survives page reloads,
// route navigations and tab swaps. Used for UI preferences (catalog
// view mode, filters, search) where the alternative is a forgetful
// page that punishes the analyst for clicking into a component and
// hitting Back.
//
// Lifecycle (mount-gated to stay hydration-safe):
//
//   Server render + client's FIRST render (hydration): both return the
//   caller-supplied `initial`. They are byte-identical, so React's
//   hydration finds no mismatch — even when the stored value drives a
//   className (e.g. a Button variant), which React 18 does NOT silently
//   patch up. An earlier version read localStorage synchronously in the
//   useState initialiser; that made the client's first render diverge
//   from the server and threw "tree hydrated but some attributes …
//   didn't match" on any preference that affected markup.
//
//   After mount: a one-shot effect reads localStorage and, when a stored
//   value exists, swaps it in with a single re-render. Users who changed
//   a preference see at most one frame of defaults before their choice
//   paints — the correct trade for not corrupting hydration.
//
//   On every change after that: the persistence effect writes the value
//   back (only once hydrated, so the pre-hydration `initial` never
//   clobbers a stored value).
//
//   On errors (private-mode browsers, disabled storage, quota, malformed
//   JSON): silently fall back to the default; in-memory state still works.

import {
  useState,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react"

const STORAGE_PREFIX = "arch-tool:"

function readStorage<T>(fullKey: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(fullKey)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function useStoredState<T>(
  key: string,
  initial: T
): [T, Dispatch<SetStateAction<T>>] {
  const fullKey = STORAGE_PREFIX + key

  // Always start from `initial` so the server and the client's first
  // render agree. The stored value is loaded after mount (below).
  const [state, setState] = useState<T>(initial)
  const [hydrated, setHydrated] = useState(false)

  // After mount, pull the persisted value (if any) in one pass.
  useEffect(() => {
    setState(readStorage(fullKey, initial))
    setHydrated(true)
    // Only re-run if the key changes; `initial` is treated as a constant
    // default for a given key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey])

  // Persist on change — but not until we've loaded, so the transient
  // pre-hydration `initial` can't overwrite a stored value.
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return
    try {
      window.localStorage.setItem(fullKey, JSON.stringify(state))
    } catch {
      // Quota / private mode / disabled storage — swallow. The in-
      // memory state still works, just won't survive a reload.
    }
  }, [fullKey, state, hydrated])

  return [state, setState]
}
