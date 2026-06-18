"use client"

// Consistency Check — two co-equal catalog audits the analyst chooses
// between before anything runs.
//
//   • AI relationship audit  — infers links that SHOULD exist but neither
//     component declares (advisory, confidence + rationale). Pre-selected.
//   • Deterministic check    — exact scan for missing backlinks (mirror
//     pairs) and duplicate links. No LLM.
//
// Opening the dialog runs NOTHING: the analyst picks a mode (AI by
// default) and confirms with "Run check". Results render grouped by
// category with a per-row Fix/Apply button; "Apply all" runs them
// serially (sha conflicts would otherwise trip the optimistic-concurrency
// lock on a second hit to the same target). Switching mode clears the
// results so each run reflects exactly one chosen check.

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ShieldCheck,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from "lucide-react"

type Category = "duplicate-links" | "links" | "inferred-links"
type Mode = "ai" | "deterministic"

interface Issue {
  id: string
  category: Category
  applyTo: string
  applyToName: string
  declaredOn: string
  declaredOnName: string
  title: string
  details: string
  /** AI-inferred issues only. */
  source?: "deterministic" | "ai"
  confidence?: number
  rationale?: string
  /** Opaque fix payload — present on AI issues so apply can send it inline. */
  fix?: unknown
}

interface RunResponse {
  components: number
  candidates?: number
  issues: Issue[]
}

type RowState =
  | { kind: "pending" }
  | { kind: "applying" }
  | { kind: "fixed" }
  | { kind: "error"; message: string }

const CATEGORY_HEADINGS: Record<Category, string> = {
  "duplicate-links": "Duplicate links",
  links: "Links",
  "inferred-links": "Missing relationships",
}

const CATEGORY_DESCRIPTIONS: Record<Category, string> = {
  "duplicate-links":
    "the same link (target + role + protocol + name) declared more than once on a component — the fix keeps one and removes the rest",
  links:
    "calls ↔ serves, part-of ↔ contains and reads-from ↔ writes-to mirror pairs (target + role + protocol + name)",
  "inferred-links":
    "advisory — links the AI thinks should exist but neither component declares; review the rationale before applying. Applying the primary link surfaces its mirror as a normal Links issue on the next deterministic check",
}

const CATEGORY_ORDER: Category[] = ["duplicate-links", "links", "inferred-links"]

const MODES: Record<Mode, { label: string; blurb: string }> = {
  ai: {
    label: "AI relationship audit",
    blurb:
      "Infers links that should exist but neither component declares — advisory, with a confidence and rationale you review before applying.",
  },
  deterministic: {
    label: "Deterministic check",
    blurb:
      "Exact scan for missing backlinks (mirror pairs) and duplicate links across the whole catalog. Fast, no AI.",
  },
}

export function ConsistencyCheckDialog() {
  const [open, setOpen] = useState(false)
  const [mode, setModeState] = useState<Mode>("ai")
  const [running, setRunning] = useState(false)
  const [components, setComponents] = useState(0)
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rowState, setRowState] = useState<Record<string, RowState>>({})
  const [applyingAll, setApplyingAll] = useState(false)

  const resetResults = () => {
    setIssues(null)
    setError(null)
    setRowState({})
    setComponents(0)
    setApplyingAll(false)
  }

  // Switching mode discards the previous check's results so the user
  // always confirms a fresh run for the mode they're looking at.
  const setMode = (m: Mode) => {
    if (m === mode) return
    setModeState(m)
    resetResults()
  }

  const runCheck = async () => {
    setRunning(true)
    setError(null)
    setRowState({})
    setIssues(null)
    try {
      const r =
        mode === "deterministic"
          ? await fetch("/api/admin/consistency-check")
          : await fetch("/api/admin/consistency-check/ai", { method: "POST" })
      const data: RunResponse | { error?: string } = await r.json()
      if (!r.ok) {
        setError(("error" in data && data.error) || `Check failed (${r.status})`)
        setIssues([])
        return
      }
      const ok = data as RunResponse
      setComponents(ok.components)
      setIssues(ok.issues || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error")
      setIssues([])
    } finally {
      setRunning(false)
    }
  }

  const applyOne = async (issue: Issue): Promise<boolean> => {
    const id = issue.id
    setRowState((s) => ({ ...s, [id]: { kind: "applying" } }))
    try {
      // AI issues aren't re-derivable by a fresh scan, so send the fix
      // inline; deterministic issues are looked up by their stable id.
      const payload =
        issue.source === "ai"
          ? { applyTo: issue.applyTo, fix: issue.fix }
          : { issueId: id }
      const r = await fetch("/api/admin/consistency-check/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok) {
        const msg =
          (data && typeof data === "object" && "error" in data
            ? String(data.error)
            : null) || `Fix failed (${r.status})`
        setRowState((s) => ({ ...s, [id]: { kind: "error", message: msg } }))
        return false
      }
      setRowState((s) => ({ ...s, [id]: { kind: "fixed" } }))
      return true
    } catch (err) {
      setRowState((s) => ({
        ...s,
        [id]: {
          kind: "error",
          message: err instanceof Error ? err.message : "Network error",
        },
      }))
      return false
    }
  }

  const allIssues: Issue[] = issues || []

  const applyAll = async () => {
    if (allIssues.length === 0) return
    setApplyingAll(true)
    // Serial — fixes to the same target would race on sha otherwise.
    for (const it of allIssues) {
      if (rowState[it.id]?.kind === "fixed") continue
      await applyOne(it)
    }
    setApplyingAll(false)
  }

  const grouped: Record<Category, Issue[]> = {
    "duplicate-links": [],
    links: [],
    "inferred-links": [],
  }
  for (const it of allIssues) grouped[it.category].push(it)

  const pendingCount = allIssues.filter(
    (it) => rowState[it.id]?.kind !== "fixed" && rowState[it.id]?.kind !== "applying"
  ).length
  const fixedCount = allIssues.filter((it) => rowState[it.id]?.kind === "fixed").length

  const noun = mode === "ai" ? "proposal" : "issue"
  const emptyMsg =
    mode === "ai" ? "no missing relationships found" : "catalog is consistent ✓"

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) {
          setModeState("ai")
          resetResults()
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <ShieldCheck className="h-4 w-4 mr-2" />
          Consistency check
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-600" />
            Catalog consistency check
          </DialogTitle>
          <DialogDescription>
            Two ways to check the catalog — pick one and run it. The{" "}
            <strong>AI relationship audit</strong> infers links that should
            exist but no one declared; the <strong>deterministic check</strong>{" "}
            scans exactly for missing backlinks and duplicate links. Each result
            is one specific change you apply with Fix, or all at once below.
          </DialogDescription>
        </DialogHeader>

        {/* Mode chooser — co-equal options; AI pre-selected. Nothing runs
            until the analyst confirms with Run check. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(["ai", "deterministic"] as const).map((m) => {
            const selected = mode === m
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                disabled={running || applyingAll}
                className={`text-left rounded-md border p-3 transition-colors ${
                  selected
                    ? "border-blue-400 bg-blue-50/60 ring-1 ring-blue-200"
                    : "border-input bg-white hover:bg-muted/40"
                } disabled:opacity-60`}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  {m === "ai" ? (
                    <Sparkles className="h-4 w-4 text-violet-600" />
                  ) : (
                    <ShieldCheck className="h-4 w-4 text-blue-600" />
                  )}
                  {MODES[m].label}
                  {selected && (
                    <Badge variant="outline" className="ml-auto text-[10px]">
                      Selected
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{MODES[m].blurb}</p>
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button onClick={runCheck} disabled={running || applyingAll}>
            {running ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Running…
              </>
            ) : issues !== null ? (
              "Run again"
            ) : (
              "Run check"
            )}
          </Button>
        </div>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="flex-1">{error}</div>
          </div>
        )}

        {!running && !error && issues !== null && (
          <>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              Scanned <strong>{components}</strong> component
              {components === 1 ? "" : "s"} —{" "}
              {allIssues.length === 0 ? (
                <span className="text-emerald-700 font-medium">{emptyMsg}</span>
              ) : (
                <>
                  <strong>{allIssues.length}</strong> {noun}
                  {allIssues.length === 1 ? "" : "s"}
                  {fixedCount > 0 && (
                    <>
                      {" "}
                      ({fixedCount} applied, {pendingCount} remaining)
                    </>
                  )}
                </>
              )}
            </div>

            {allIssues.length > 0 && (
              <div className="space-y-5">
                {CATEGORY_ORDER.map((cat) => {
                  const items = grouped[cat]
                  if (items.length === 0) return null
                  return (
                    <div key={cat}>
                      <div className="flex items-baseline gap-2 mb-2">
                        <h3 className="text-sm font-semibold">{CATEGORY_HEADINGS[cat]}</h3>
                        <span className="text-xs text-muted-foreground">({items.length})</span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">
                        {CATEGORY_DESCRIPTIONS[cat]}
                      </p>
                      <div className="space-y-2">
                        {items.map((it) => {
                          const st = rowState[it.id] ?? { kind: "pending" }
                          const fixed = st.kind === "fixed"
                          const applying = st.kind === "applying"
                          const errored = st.kind === "error"
                          return (
                            <div
                              key={it.id}
                              className={`rounded-md border p-3 ${
                                fixed
                                  ? "bg-emerald-50/50 border-emerald-200"
                                  : errored
                                  ? "bg-red-50/40 border-red-200"
                                  : "bg-white"
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap text-sm font-medium">
                                    <Badge variant="outline" className="text-[10px] uppercase shrink-0">
                                      Apply to {it.applyToName}
                                    </Badge>
                                    {it.source === "ai" && (
                                      <Badge
                                        variant="outline"
                                        className="gap-1 text-[10px] shrink-0 text-violet-700 border-violet-300 bg-violet-50"
                                      >
                                        <Sparkles className="h-3 w-3" />
                                        AI
                                        {typeof it.confidence === "number" &&
                                          ` · ${Math.round(it.confidence * 100)}%`}
                                      </Badge>
                                    )}
                                    <span className="truncate">{it.title}</span>
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-1">{it.details}</p>
                                  {errored && (
                                    <p className="text-xs text-red-700 mt-2 flex items-start gap-1">
                                      <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                                      {st.message}
                                    </p>
                                  )}
                                </div>
                                <div className="shrink-0">
                                  {fixed ? (
                                    <Badge
                                      variant="outline"
                                      className="gap-1 text-[10px] text-emerald-700 border-emerald-300 bg-emerald-50"
                                    >
                                      <CheckCircle2 className="h-3 w-3" />
                                      Applied
                                    </Badge>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant={errored ? "outline" : "default"}
                                      onClick={() => applyOne(it)}
                                      disabled={applying || applyingAll}
                                    >
                                      {applying ? (
                                        <>
                                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                          Applying…
                                        </>
                                      ) : errored ? (
                                        "Retry"
                                      ) : (
                                        "Fix"
                                      )}
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {allIssues.length > 0 && pendingCount > 0 && (
              <div className="flex items-center justify-end gap-2 pt-3 border-t">
                <Button variant="default" onClick={applyAll} disabled={applyingAll}>
                  {applyingAll ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Applying {pendingCount}…
                    </>
                  ) : (
                    <>Apply all ({pendingCount})</>
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
