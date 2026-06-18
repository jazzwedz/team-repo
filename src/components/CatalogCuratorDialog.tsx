"use client"

// Catalog Curator — upload a document, get grounded catalog proposals.
//
// Flow: pick a PDF → Analyze (POST /api/catalog-curator, transient — the
// file is never stored) → review proposals grouped by component, each an
// Add / Update / Conflict with a page-cited verbatim quote, confidence and
// rationale → tick the good ones → Apply selected (each component is
// fetched with its sha, the ticked changes merged in, and saved through
// the normal component PUT). Each proposal can be rated 👍/👎; that
// feedback trains the catalog-curator agent via the coach pass, which the
// "Improve Curator from feedback" control runs.

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
  FileSearch,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
  GraduationCap,
} from "lucide-react"

type Change = "add" | "update" | "conflict"
type Field = "description" | "capability" | "rule"

interface Proposal {
  id: string
  componentId: string
  componentName: string
  change: Change
  field: Field
  description?: string
  capability?: { name: string; role: string; description?: string }
  rule?: { name: string; kind: string; summary?: string }
  current?: string
  rationale: string
  confidence: number
  source: { page: number; quote: string }
}

const CHANGE_STYLE: Record<Change, string> = {
  add: "text-emerald-700 border-emerald-300 bg-emerald-50",
  update: "text-blue-700 border-blue-300 bg-blue-50",
  conflict: "text-rose-700 border-rose-300 bg-rose-50",
}

function summarize(p: Proposal): string {
  const what =
    p.field === "description"
      ? "description"
      : p.field === "capability"
      ? `capability "${p.capability?.name}"`
      : `rule "${p.rule?.name}"`
  return `${p.change} ${what} on ${p.componentName}`
}

export function CatalogCuratorDialog() {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [docName, setDocName] = useState<string>("")
  const [proposals, setProposals] = useState<Proposal[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<Set<string>>(new Set())
  const [failed, setFailed] = useState<Set<string>>(new Set())
  const [feedback, setFeedback] = useState<Record<string, "up" | "down">>({})

  // Coach pass.
  const [coachOpen, setCoachOpen] = useState(false)
  const [coachLoading, setCoachLoading] = useState(false)
  const [coachError, setCoachError] = useState<string | null>(null)
  const [coachProposal, setCoachProposal] = useState<{ rationale: string; lessons: string; feedbackConsidered: number } | null>(null)
  const [coachApplying, setCoachApplying] = useState(false)
  const [coachDone, setCoachDone] = useState(false)

  const reset = () => {
    setFile(null)
    setAnalyzing(false)
    setError(null)
    setDocName("")
    setProposals(null)
    setSelected(new Set())
    setApplying(false)
    setApplied(new Set())
    setFailed(new Set())
    setFeedback({})
    setCoachOpen(false)
    setCoachProposal(null)
    setCoachDone(false)
    setCoachError(null)
  }

  const analyze = async () => {
    if (!file) return
    setAnalyzing(true)
    setError(null)
    setProposals(null)
    try {
      const form = new FormData()
      form.append("file", file)
      const r = await fetch("/api/catalog-curator", { method: "POST", body: form })
      const data = await r.json().catch(() => null)
      if (!r.ok) {
        setError((data && data.error) || `Analysis failed (${r.status})`)
        return
      }
      setDocName(data.docName || file.name)
      setProposals(data.proposals || [])
      // Pre-tick everything; the analyst unticks what they don't want.
      setSelected(new Set<string>((data.proposals || []).map((p: Proposal) => p.id)))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error")
    } finally {
      setAnalyzing(false)
    }
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Merge a component's ticked proposals and save through the normal PUT.
  const applyComponent = async (componentId: string, items: Proposal[]): Promise<boolean> => {
    try {
      const r = await fetch(`/api/components/${encodeURIComponent(componentId)}`)
      const comp = await r.json().catch(() => null)
      if (!r.ok || !comp) return false

      for (const p of items) {
        if (p.field === "description" && p.description) {
          comp.description = { ...(comp.description || {}), description: p.description }
        } else if (p.field === "capability" && p.capability) {
          const cap = { name: p.capability.name, role: p.capability.role, ...(p.capability.description ? { description: p.capability.description } : {}) }
          const list = [...(comp.capabilities || [])]
          const idx = list.findIndex((x: { name?: string }) => (x.name || "").toLowerCase() === cap.name.toLowerCase())
          if (idx >= 0) list[idx] = { ...list[idx], ...cap }
          else list.push(cap)
          comp.capabilities = list
        } else if (p.field === "rule" && p.rule) {
          const rule = { name: p.rule.name, kind: p.rule.kind, ...(p.rule.summary ? { summary: p.rule.summary } : {}) }
          const list = [...(comp.rules || [])]
          const idx = list.findIndex((x: { name?: string }) => (x.name || "").toLowerCase() === rule.name.toLowerCase())
          if (idx >= 0) list[idx] = { ...list[idx], ...rule }
          else list.push(rule)
          comp.rules = list
        }
      }

      const put = await fetch(`/api/components/${encodeURIComponent(componentId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...comp, sha: comp.sha }),
      })
      return put.ok
    } catch {
      return false
    }
  }

  const applySelected = async () => {
    if (!proposals) return
    const chosen = proposals.filter((p) => selected.has(p.id) && !applied.has(p.id))
    if (chosen.length === 0) return
    setApplying(true)
    setError(null)
    // Group by component so each is fetched + saved once (one sha per save).
    const byComp = new Map<string, Proposal[]>()
    for (const p of chosen) (byComp.get(p.componentId) ?? byComp.set(p.componentId, []).get(p.componentId)!).push(p)

    const ok = new Set(applied)
    const bad = new Set<string>()
    for (const [componentId, items] of byComp) {
      const success = await applyComponent(componentId, items)
      for (const p of items) (success ? ok : bad).add(p.id)
    }
    setApplied(ok)
    setFailed(bad)
    setApplying(false)
    if (bad.size > 0) setError(`${bad.size} change${bad.size === 1 ? "" : "s"} could not be saved (highlighted).`)
  }

  const rate = async (p: Proposal, rating: "up" | "down") => {
    setFeedback((f) => ({ ...f, [p.id]: rating }))
    try {
      await fetch("/api/catalog-curator/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, proposalSummary: summarize(p) }),
      })
    } catch {
      // best-effort; keep the optimistic UI
    }
  }

  const runCoach = async () => {
    setCoachOpen(true)
    setCoachLoading(true)
    setCoachError(null)
    setCoachProposal(null)
    setCoachDone(false)
    try {
      const r = await fetch("/api/catalog-curator/coach", { method: "POST" })
      const data = await r.json().catch(() => null)
      if (!r.ok) {
        setCoachError((data && data.error) || `Coach failed (${r.status})`)
        return
      }
      if (!data.proposal) {
        setCoachError(data.feedbackConsidered === 0 ? "No new feedback to learn from yet." : "The coach had no improvement to propose.")
        return
      }
      setCoachProposal(data.proposal)
    } catch (err) {
      setCoachError(err instanceof Error ? err.message : "Network error")
    } finally {
      setCoachLoading(false)
    }
  }

  const applyCoach = async () => {
    if (!coachProposal) return
    setCoachApplying(true)
    setCoachError(null)
    try {
      const r = await fetch("/api/agents/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "catalog-curator", lessons: coachProposal.lessons }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => null)
        setCoachError((d && d.error) || `Apply failed (${r.status})`)
        return
      }
      setCoachDone(true)
      setCoachProposal(null)
    } catch (err) {
      setCoachError(err instanceof Error ? err.message : "Network error")
    } finally {
      setCoachApplying(false)
    }
  }

  const grouped = new Map<string, Proposal[]>()
  for (const p of proposals || []) (grouped.get(p.componentId) ?? grouped.set(p.componentId, []).get(p.componentId)!).push(p)
  const selectedCount = (proposals || []).filter((p) => selected.has(p.id) && !applied.has(p.id)).length

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileSearch className="h-4 w-4 mr-2" />
          Curate from doc
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl top-12 translate-y-0 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSearch className="h-5 w-5 text-violet-600" />
            Curate catalog from a document
          </DialogTitle>
          <DialogDescription>
            Upload a PDF. The Catalog Curator reads it (the file is not stored),
            cross-references your components, and proposes grounded
            Add / Update / Conflict changes — each with a page-cited quote.
            Nothing is saved until you approve it.
          </DialogDescription>
        </DialogHeader>

        {/* Upload */}
        {proposals === null && (
          <div className="space-y-3">
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-muted file:px-3 file:py-1.5 file:text-sm"
            />
            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={analyze} disabled={!file || analyzing}>
                {analyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Analyzing…
                  </>
                ) : (
                  "Analyze"
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Results */}
        {proposals !== null && (
          <>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm flex items-center justify-between flex-wrap gap-2">
              <span>
                <strong>{docName}</strong> —{" "}
                {proposals.length === 0 ? (
                  <span className="text-muted-foreground">nothing worth recording found</span>
                ) : (
                  <>
                    <strong>{proposals.length}</strong> proposal{proposals.length === 1 ? "" : "s"}
                  </>
                )}
              </span>
              <Button size="sm" variant="ghost" onClick={reset}>
                New document
              </Button>
            </div>

            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {[...grouped.entries()].map(([componentId, items]) => (
              <div key={componentId} className="space-y-2">
                <h3 className="text-sm font-semibold">{items[0].componentName}</h3>
                {items.map((p) => {
                  const isApplied = applied.has(p.id)
                  const isFailed = failed.has(p.id)
                  return (
                    <div
                      key={p.id}
                      className={`rounded-md border p-3 ${
                        isApplied ? "bg-emerald-50/50 border-emerald-200" : isFailed ? "bg-red-50/40 border-red-200" : "bg-white"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={selected.has(p.id)}
                          disabled={isApplied}
                          onChange={() => toggle(p.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap text-sm font-medium">
                            <Badge variant="outline" className={`text-[10px] uppercase shrink-0 ${CHANGE_STYLE[p.change]}`}>
                              {p.change}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] shrink-0">
                              {p.field}
                            </Badge>
                            <span className="text-muted-foreground text-xs">{Math.round(p.confidence * 100)}%</span>
                            {isApplied && (
                              <Badge variant="outline" className="gap-1 text-[10px] text-emerald-700 border-emerald-300 bg-emerald-50">
                                <CheckCircle2 className="h-3 w-3" />
                                Saved
                              </Badge>
                            )}
                          </div>

                          {/* Proposed value */}
                          <div className="text-sm mt-1">
                            {p.field === "description" && <span>{p.description}</span>}
                            {p.field === "capability" && p.capability && (
                              <span>
                                <strong>{p.capability.name}</strong> ({p.capability.role})
                                {p.capability.description ? ` — ${p.capability.description}` : ""}
                              </span>
                            )}
                            {p.field === "rule" && p.rule && (
                              <span>
                                <strong>{p.rule.name}</strong> ({p.rule.kind})
                                {p.rule.summary ? ` — ${p.rule.summary}` : ""}
                              </span>
                            )}
                          </div>

                          {p.current && (
                            <p className="text-xs text-muted-foreground mt-1">
                              <span className="font-medium">Currently:</span> {p.current}
                            </p>
                          )}

                          <p className="text-xs text-muted-foreground mt-1">{p.rationale}</p>

                          {/* Source citation */}
                          <blockquote className="mt-2 border-l-2 border-violet-300 pl-2 text-xs text-muted-foreground italic">
                            “{p.source.quote}” <span className="not-italic">— p.{p.source.page}</span>
                          </blockquote>

                          {/* Feedback */}
                          <div className="flex items-center gap-1 mt-2">
                            <button
                              type="button"
                              onClick={() => rate(p, "up")}
                              className={`p-1 rounded hover:bg-muted ${feedback[p.id] === "up" ? "text-emerald-600" : "text-muted-foreground"}`}
                              title="Good proposal"
                            >
                              <ThumbsUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => rate(p, "down")}
                              className={`p-1 rounded hover:bg-muted ${feedback[p.id] === "down" ? "text-rose-600" : "text-muted-foreground"}`}
                              title="Bad proposal"
                            >
                              <ThumbsDown className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}

            {/* Footer actions */}
            <div className="flex items-center justify-between gap-2 pt-3 border-t flex-wrap">
              <Button variant="ghost" size="sm" onClick={runCoach} disabled={coachLoading}>
                {coachLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <GraduationCap className="h-4 w-4 mr-1" />}
                Improve Curator from feedback
              </Button>
              {selectedCount > 0 && (
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
              )}
            </div>

            {/* Coach panel */}
            {coachOpen && (
              <div className="rounded-md border bg-muted/20 p-3 text-sm space-y-2">
                <div className="flex items-center gap-2 font-medium">
                  <GraduationCap className="h-4 w-4" />
                  Curator coach
                </div>
                {coachError && <p className="text-xs text-muted-foreground">{coachError}</p>}
                {coachDone && <p className="text-xs text-emerald-700">Lessons committed — the Curator will use them next run.</p>}
                {coachProposal && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {coachProposal.rationale} ({coachProposal.feedbackConsidered} feedback item
                      {coachProposal.feedbackConsidered === 1 ? "" : "s"} considered)
                    </p>
                    <pre className="text-xs bg-white border rounded p-2 whitespace-pre-wrap">{coachProposal.lessons}</pre>
                    <div className="flex justify-end">
                      <Button size="sm" onClick={applyCoach} disabled={coachApplying}>
                        {coachApplying ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                        Approve &amp; commit lessons
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
