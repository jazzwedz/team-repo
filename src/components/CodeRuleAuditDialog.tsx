"use client"

// Check rules against code — runs the code-rule-auditor on a component's
// mapped source files and lets the analyst approve the resulting
// `implemented` facets (and any undocumented rules found in code).
//
// Read → review → approve → commit: the audit reads the source repo and
// proposes; applying merges the implemented facet + reconciliation onto
// the component's rules (and appends implemented-only rules) and saves
// through the normal sha-guarded component PUT. Nothing is written until
// the analyst ticks and applies.

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
import { Loader2, AlertCircle, CheckCircle2, FileCode2 } from "lucide-react"
import { ProvenancePanel, type ProvenanceRow } from "@/components/ProvenancePanel"
import type { ComponentRule, Reconciliation, CodeEvidence } from "@/lib/types"

interface Proposal {
  target: "existing" | "new"
  name: string
  kind?: string
  reconciliation: Reconciliation
  implemented?: {
    summary?: string
    formula?: string
    given?: string
    when?: string
    then?: string
    evidence?: CodeEvidence
  }
  note?: string
}

function facetRows(f?: {
  summary?: string
  formula?: string
  given?: string
  when?: string
  then?: string
}): ProvenanceRow[] {
  if (!f) return []
  const rows: ProvenanceRow[] = []
  if (f.summary) rows.push({ label: "Summary", value: f.summary })
  if (f.formula) rows.push({ label: "Formula", value: f.formula })
  if (f.given) rows.push({ label: "Given", value: f.given })
  if (f.when) rows.push({ label: "When", value: f.when })
  if (f.then) rows.push({ label: "Then", value: f.then })
  return rows
}

export function CodeRuleAuditDialog({
  open,
  onOpenChange,
  componentId,
  rules,
  onApplied,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  componentId: string
  rules: ComponentRule[]
  onApplied?: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposals, setProposals] = useState<Proposal[] | null>(null)
  const [files, setFiles] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)

  const rulesByName = new Map(rules.map((r) => [r.name.toLowerCase(), r]))

  const run = async () => {
    setLoading(true)
    setError(null)
    setProposals(null)
    setApplied(false)
    try {
      const r = await fetch(`/api/components/${encodeURIComponent(componentId)}/code-rule-audit`, {
        method: "POST",
      })
      const data = await r.json().catch(() => null)
      if (!r.ok) {
        setError((data && data.error) || `Audit failed (${r.status})`)
        return
      }
      const ps: Proposal[] = data.proposals || []
      setProposals(ps)
      setFiles(data.files || [])
      // Pre-tick everything that carries a grounded change.
      setSelected(new Set(ps.map((_, i) => String(i))))
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
      setSelected(new Set())
      setApplied(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const applySelected = async () => {
    if (!proposals) return
    const chosen = proposals.filter((_, i) => selected.has(String(i)))
    if (chosen.length === 0) return
    setApplying(true)
    setError(null)
    try {
      const r = await fetch(`/api/components/${encodeURIComponent(componentId)}`)
      const comp = await r.json().catch(() => null)
      if (!r.ok || !comp) throw new Error("Could not load the component to save.")
      const list: ComponentRule[] = [...(comp.rules || [])]

      for (const p of chosen) {
        if (p.target === "existing") {
          const idx = list.findIndex((x) => (x.name || "").toLowerCase() === p.name.toLowerCase())
          if (idx < 0) continue
          list[idx] = { ...list[idx], implemented: p.implemented, reconciliation: p.reconciliation }
        } else {
          // implemented-only — append a new rule whose canonical fields mirror the derived code.
          const impl = p.implemented || {}
          list.push({
            name: p.name,
            kind: (p.kind as ComponentRule["kind"]) || "rule",
            ...(impl.summary ? { summary: impl.summary } : {}),
            ...(impl.formula ? { formula: impl.formula } : {}),
            ...(impl.given ? { given: impl.given } : {}),
            ...(impl.when ? { when: impl.when } : {}),
            ...(impl.then ? { then: impl.then } : {}),
            implemented: p.implemented,
            reconciliation: "implemented-only",
          })
        }
      }

      const put = await fetch(`/api/components/${encodeURIComponent(componentId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...comp, rules: list, sha: comp.sha }),
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

  const selectedCount = proposals ? proposals.filter((_, i) => selected.has(String(i))).length : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl top-12 translate-y-0 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCode2 className="h-5 w-5 text-blue-600" />
            Check rules against code
          </DialogTitle>
          <DialogDescription>
            Reads this component&apos;s mapped source files and fills each rule&apos;s
            <strong> implemented</strong> facet from the actual code, flagging where the
            code is consistent with, diverges from, or is missing the documented rule.
            Nothing is saved until you approve it.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading source &amp; comparing…
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
            Applied — the rules now carry their implemented facet.
          </div>
        )}

        {!loading && proposals !== null && !applied && (
          <>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              Read <strong>{files.length}</strong> file{files.length === 1 ? "" : "s"} —{" "}
              {proposals.length === 0 ? (
                <span className="text-muted-foreground">nothing to reconcile</span>
              ) : (
                <>
                  <strong>{proposals.length}</strong> finding{proposals.length === 1 ? "" : "s"}
                </>
              )}
            </div>

            {proposals.map((p, i) => {
              const existing = rulesByName.get(p.name.toLowerCase())
              const key = String(i)
              return (
                <div key={key} className="rounded-md border p-3 bg-white">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.has(key)}
                      onChange={() => toggle(key)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap text-sm font-medium">
                        {p.target === "new" && (
                          <Badge variant="outline" className="text-[10px] text-blue-700 border-blue-300 bg-blue-50">
                            undocumented
                          </Badge>
                        )}
                        <span className="truncate">{p.name}</span>
                        {p.kind && <Badge variant="outline" className="text-[10px]">{p.kind}</Badge>}
                      </div>
                      {p.note && <p className="text-xs text-muted-foreground mt-1">{p.note}</p>}
                      <ProvenancePanel
                        reconciliation={p.reconciliation}
                        requested={
                          existing
                            ? { rows: facetRows(existing) }
                            : undefined
                        }
                        implemented={
                          p.implemented
                            ? { rows: facetRows(p.implemented), evidence: p.implemented.evidence }
                            : undefined
                        }
                      />
                    </div>
                  </div>
                </div>
              )
            })}

            {selectedCount > 0 && (
              <div className="flex justify-end pt-3 border-t">
                <Button onClick={applySelected} disabled={applying}>
                  {applying ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Applying…
                    </>
                  ) : (
                    <>Apply selected ({selectedCount})</>
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
