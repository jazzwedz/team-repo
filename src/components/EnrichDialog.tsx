"use client"

// Review & apply catalog enrichments proposed from a solution's sources
// (BRD + current catalog entries). One run: tick the proposals to keep, hit
// a single Apply, and we commit them and close (back to the Documentation
// tab). No re-proposing loop. Each apply goes through the normal component
// save (sha/lock-guarded); existing entries are never overwritten.

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, AlertCircle, Sparkles } from "lucide-react"

interface CapProposal {
  name: string
  role: string
  description?: string
  rationale?: string
}
interface RuleProposal {
  name: string
  kind: string
  summary?: string
  rationale?: string
}
interface Proposal {
  componentId: string
  componentName: string
  currentDescription: string
  description?: { proposed: string; rationale?: string }
  capabilities: CapProposal[]
  rules: RuleProposal[]
}

function toggle(set: Set<number>, i: number): Set<number> {
  const n = new Set(set)
  if (n.has(i)) n.delete(i)
  else n.add(i)
  return n
}

export function EnrichDialog({
  open,
  onOpenChange,
  solutionId,
  onApplied,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  solutionId: string
  onApplied?: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [descOn, setDescOn] = useState<Record<string, boolean>>({})
  const [descText, setDescText] = useState<Record<string, string>>({})
  const [capOn, setCapOn] = useState<Record<string, Set<number>>>({})
  const [ruleOn, setRuleOn] = useState<Record<string, Set<number>>>({})
  const [applying, setApplying] = useState(false)
  const [failed, setFailed] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    setProposals([])
    setFailed(new Set())
    fetch(`/api/solutions/${encodeURIComponent(solutionId)}/enrich`, { method: "POST" })
      .then(async (r) => {
        const d = await r.json().catch(() => null)
        if (!r.ok) throw new Error((d && d.error) || `Failed (${r.status})`)
        return d
      })
      .then((d) => {
        const ps: Proposal[] = Array.isArray(d.proposals) ? d.proposals : []
        setProposals(ps)
        const dOn: Record<string, boolean> = {}
        const dT: Record<string, string> = {}
        const cOn: Record<string, Set<number>> = {}
        const rOn: Record<string, Set<number>> = {}
        for (const p of ps) {
          if (p.description) {
            dOn[p.componentId] = true
            dT[p.componentId] = p.description.proposed
          }
          cOn[p.componentId] = new Set(p.capabilities.map((_, i) => i))
          rOn[p.componentId] = new Set(p.rules.map((_, i) => i))
        }
        setDescOn(dOn)
        setDescText(dT)
        setCapOn(cOn)
        setRuleOn(rOn)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to propose enrichments"))
      .finally(() => setLoading(false))
  }, [open, solutionId])

  const hasApproved = (p: Proposal): boolean =>
    (!!p.description && descOn[p.componentId]) ||
    (capOn[p.componentId]?.size || 0) > 0 ||
    (ruleOn[p.componentId]?.size || 0) > 0

  const approvedCount = proposals.filter(hasApproved).length

  // Apply one component's approved patches through the normal save.
  async function applyOne(p: Proposal): Promise<boolean> {
    try {
      const r = await fetch(`/api/components/${encodeURIComponent(p.componentId)}`)
      const comp = await r.json().catch(() => null)
      if (!r.ok || !comp) return false

      if (p.description && descOn[p.componentId] && descText[p.componentId]?.trim()) {
        comp.description = { ...(comp.description || {}), description: descText[p.componentId].trim() }
      }
      const caps = p.capabilities.filter((_, i) => capOn[p.componentId]?.has(i))
      if (caps.length) {
        comp.capabilities = [
          ...(comp.capabilities || []),
          ...caps.map((c) => ({ name: c.name, role: c.role, ...(c.description ? { description: c.description } : {}) })),
        ]
      }
      const rules = p.rules.filter((_, i) => ruleOn[p.componentId]?.has(i))
      if (rules.length) {
        comp.rules = [
          ...(comp.rules || []),
          ...rules.map((r2) => ({ name: r2.name, kind: r2.kind, ...(r2.summary ? { summary: r2.summary } : {}) })),
        ]
      }

      const put = await fetch(`/api/components/${encodeURIComponent(p.componentId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...comp, sha: comp.sha }),
      })
      return put.ok
    } catch {
      return false
    }
  }

  async function applyAll() {
    const targets = proposals.filter(hasApproved)
    if (targets.length === 0) return
    setApplying(true)
    setError(null)
    const fails = new Set<string>()
    for (const p of targets) {
      const ok = await applyOne(p)
      if (!ok) fails.add(p.componentId)
    }
    setApplying(false)
    onApplied?.()
    if (fails.size === 0) {
      onOpenChange(false) // back to the Documentation tab
    } else {
      setFailed(fails)
      setError(`${fails.size} component${fails.size === 1 ? "" : "s"} could not be saved (highlighted). The rest were applied.`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl top-12 translate-y-0 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Improve data from DSD
          </DialogTitle>
          <DialogDescription>
            Proposed business-focused improvements from the solution&apos;s source document(s) and current
            catalog. Tick what to keep, then Apply — nothing is saved until you do.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Analysing the sources…
          </div>
        ) : error && proposals.length === 0 ? (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        ) : proposals.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No improvements proposed — the catalog already reflects the sources, or no source document is
            stored on this solution.
          </p>
        ) : (
          <div className="space-y-3">
            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-900">{error}</div>
            )}
            {proposals.map((p) => (
              <div
                key={p.componentId}
                className={`rounded-md border p-3 space-y-2 ${failed.has(p.componentId) ? "border-red-400 bg-red-50/40" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{p.componentName}</span>
                  <code className="text-[11px] text-muted-foreground">{p.componentId}</code>
                  {failed.has(p.componentId) && (
                    <span className="ml-auto text-xs text-red-700">not saved</span>
                  )}
                </div>

                {p.description && (
                  <label className="block rounded-md border bg-muted/20 p-2">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5"
                        checked={!!descOn[p.componentId]}
                        onChange={(e) => setDescOn((s) => ({ ...s, [p.componentId]: e.target.checked }))}
                      />
                      Description {p.currentDescription ? "(replace)" : "(set)"}
                    </div>
                    {p.description.rationale && (
                      <div className="mt-1 text-[11px] text-muted-foreground italic">{p.description.rationale}</div>
                    )}
                    <Textarea
                      value={descText[p.componentId] ?? ""}
                      onChange={(e) => setDescText((s) => ({ ...s, [p.componentId]: e.target.value }))}
                      rows={3}
                      className="mt-1 text-xs bg-white"
                      disabled={!descOn[p.componentId]}
                    />
                    {p.currentDescription && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[11px] text-muted-foreground">current</summary>
                        <p className="mt-1 text-[11px] text-muted-foreground whitespace-pre-wrap">{p.currentDescription}</p>
                      </details>
                    )}
                  </label>
                )}

                {p.capabilities.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium">New capabilities</div>
                    {p.capabilities.map((c, i) => (
                      <label key={i} className="flex items-start gap-2 text-xs">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-3.5 w-3.5"
                          checked={capOn[p.componentId]?.has(i) || false}
                          onChange={() => setCapOn((s) => ({ ...s, [p.componentId]: toggle(s[p.componentId] || new Set(), i) }))}
                        />
                        <span>
                          <span className="font-medium">{c.name}</span> <span className="text-muted-foreground">({c.role})</span>
                          {c.rationale && <span className="text-muted-foreground italic"> — {c.rationale}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                {p.rules.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium">New business rules</div>
                    {p.rules.map((r, i) => (
                      <label key={i} className="flex items-start gap-2 text-xs">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-3.5 w-3.5"
                          checked={ruleOn[p.componentId]?.has(i) || false}
                          onChange={() => setRuleOn((s) => ({ ...s, [p.componentId]: toggle(s[p.componentId] || new Set(), i) }))}
                        />
                        <span>
                          <span className="font-medium">{r.name}</span> <span className="text-muted-foreground">({r.kind})</span>
                          {r.summary && <span> — {r.summary}</span>}
                          {r.rationale && <span className="text-muted-foreground italic"> · {r.rationale}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            Close
          </Button>
          {proposals.length > 0 && (
            <Button onClick={applyAll} disabled={applying || approvedCount === 0}>
              {applying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Applying…
                </>
              ) : (
                `Apply${approvedCount ? ` (${approvedCount})` : ""}`
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
