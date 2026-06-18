"use client"

// Find source files — runs the source-mapper on a component and lets the
// analyst approve which files implement it. Writes source.paths (union
// with anything already mapped) through the normal sha-guarded component
// save. Standalone: once source.paths is set, the rule audit and other
// code-aware features pick it up.

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Loader2, AlertCircle, CheckCircle2, Radar } from "lucide-react"

interface Proposal {
  path: string
  confidence: number
  reason: string
}

export function SourceScanDialog({
  open,
  onOpenChange,
  componentId,
  existingPaths,
  onApplied,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  componentId: string
  existingPaths: string[]
  onApplied?: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [proposals, setProposals] = useState<Proposal[] | null>(null)
  const [indexed, setIndexed] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)

  const already = new Set(existingPaths)

  const run = async () => {
    setLoading(true)
    setError(null)
    setNote(null)
    setProposals(null)
    setApplied(false)
    try {
      const r = await fetch(`/api/components/${encodeURIComponent(componentId)}/source-scan`, {
        method: "POST",
      })
      const data = await r.json().catch(() => null)
      if (!r.ok) {
        setError((data && data.error) || `Scan failed (${r.status})`)
        return
      }
      const ps: Proposal[] = (data.proposals || []).filter((p: Proposal) => !already.has(p.path))
      setProposals(ps)
      setIndexed(data.indexed || 0)
      setNote(data.note || null)
      // Pre-tick everything with decent confidence.
      setSelected(new Set(ps.filter((p) => p.confidence >= 0.6).map((p) => p.path)))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) run()
    else {
      setProposals(null)
      setError(null)
      setNote(null)
      setSelected(new Set())
      setApplied(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toggle = (path: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const applySelected = async () => {
    if (selected.size === 0) return
    setApplying(true)
    setError(null)
    try {
      const r = await fetch(`/api/components/${encodeURIComponent(componentId)}`)
      const comp = await r.json().catch(() => null)
      if (!r.ok || !comp) throw new Error("Could not load the component to save.")
      const merged = Array.from(new Set([...(comp.source?.paths || []), ...selected]))
      const source = { ...(comp.source || {}), paths: merged }
      const put = await fetch(`/api/components/${encodeURIComponent(componentId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...comp, source, sha: comp.sha }),
      })
      if (!put.ok) {
        const d = await put.json().catch(() => null)
        throw new Error((d && d.error) || `Save failed (${put.status})`)
      }
      setApplied(true)
      onApplied?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
    } finally {
      setApplying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl top-12 translate-y-0 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radar className="h-5 w-5 text-blue-600" />
            Find source files
          </DialogTitle>
          <DialogDescription>
            Scans the connected source repository and proposes which files implement
            this component, so you don&apos;t have to know the code layout. Approved
            files are saved as the component&apos;s <code>source.paths</code>, which the
            code-aware checks then use.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" />
            Scanning the repository…
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {applied && (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            Saved — the component now maps these source files. You can run “Check against code” on its rules.
          </div>
        )}

        {!loading && proposals !== null && !applied && (
          <>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              Indexed <strong>{indexed}</strong> source file{indexed === 1 ? "" : "s"} —{" "}
              {proposals.length === 0 ? (
                <span className="text-muted-foreground">{note || "no new matches"}</span>
              ) : (
                <>
                  <strong>{proposals.length}</strong> proposed
                </>
              )}
            </div>

            {existingPaths.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Already mapped: {existingPaths.map((p) => <code key={p} className="mr-2">{p}</code>)}
              </p>
            )}

            {proposals.map((p) => (
              <label
                key={p.path}
                className="flex items-start gap-2 rounded-md border p-3 bg-white cursor-pointer"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.has(p.path)}
                  onChange={() => toggle(p.path)}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs break-all">{p.path}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {Math.round(p.confidence * 100)}%
                    </Badge>
                  </div>
                  {p.reason && <p className="text-xs text-muted-foreground mt-1">{p.reason}</p>}
                </div>
              </label>
            ))}

            {proposals.length > 0 && (
              <div className="flex justify-end pt-3 border-t">
                <Button onClick={applySelected} disabled={applying || selected.size === 0}>
                  {applying ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>Map selected ({selected.size})</>
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
