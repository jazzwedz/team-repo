"use client"

// Solution composer — 4-step, click-first wizard.
//   1. Intent     — name + pick delivered capabilities/processes (chips)
//   2. Skeleton   — deterministic proposer; tick members, set disposition,
//                   accept gap → new component
//   3. Flows      — accept existing, add proposed (dropdowns)
//   4. Review     — scoped diagram + Create
// Nothing is written until Create (propose → approve → create).

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ArrowLeft, Loader2, AlertCircle, Plus, X, Sparkles, Info, FileUp, ChevronUp, ChevronDown, ArrowDownAZ } from "lucide-react"
import { MermaidPreview } from "@/components/mermaid-preview"
import { ChipPicker } from "@/components/ChipPicker"
import { ProcessesEditor } from "@/components/ProcessesEditor"
import { AgentRunModal } from "@/components/AgentRunModal"
import { buildSolutionMermaid } from "@/lib/architecture-mermaid"
import { buildSolutionSequenceMermaid } from "@/lib/solution-sequence"
import { buildProcessDraftMembers } from "@/lib/process-draft-payload"
import { proposeSolution, type SolutionProposal } from "@/lib/solution-proposer"
import { slugifyId } from "@/lib/component-schema"
import {
  BUSINESS_CAPABILITIES,
  MEMBER_DISPOSITIONS,
  MEMBER_DISPOSITION_LABELS,
  LINK_ROLES,
  LINK_PROTOCOLS,
} from "@/lib/constants"
import type {
  Component,
  ComponentType,
  MemberDisposition,
  SolutionFlow,
  SolutionMember,
  SolutionProcess,
  Solution,
  LinkRole,
  LinkProtocol,
} from "@/lib/types"

interface MemberState {
  include: boolean
  disposition: MemberDisposition
  role: string
  reason?: string
}
interface GapState {
  include: boolean
  name: string
  type: ComponentType
  kind: "capability" | "process"
  value: string
}

interface AiCompose {
  // Suggested goal/description derived from the name (+ any source doc).
  // Applied only when the corresponding field is still empty.
  goal?: string
  description?: string
  delivers: { capabilities: string[] }
  members: { component: string; disposition: MemberDisposition; role?: string }[]
  newComponents: { name: string; type: ComponentType; role?: string }[]
  flows: SolutionFlow[]
  /** Optional starter "main" process sequence (applied only when empty). */
  process?: SolutionProcess
}

export default function NewSolutionPage() {
  const router = useRouter()
  const [components, setComponents] = useState<Component[]>([])
  const [step, setStep] = useState(1)

  const [name, setName] = useState("")
  const [goal, setGoal] = useState("")
  const [owner, setOwner] = useState("")
  const [desc, setDesc] = useState("")
  const [selCaps, setSelCaps] = useState<string[]>([])

  // BRD / document upload → prefill description
  const brdInputRef = useRef<HTMLInputElement>(null)
  const [brdBusy, setBrdBusy] = useState(false)
  const [brdError, setBrdError] = useState<string | null>(null)
  // AI is extrapolating the goal from an uploaded document (only when the
  // goal field was empty at upload time).
  const [goalBusy, setGoalBusy] = useState(false)
  // Uploaded source documentation, kept as EXTRACTED TEXT (we never store
  // the binary) and used purely as AI context during composition. It
  // survives reload via the draft, but is deliberately NOT written to the
  // saved solution — raw requirement text can carry vendor terms that must
  // not land in the repo, and it isn't part of the solution model.
  const [sourceDoc, setSourceDoc] = useState<{ name: string; text: string } | null>(null)
  const [showSource, setShowSource] = useState(false)
  // True once an AI pre-fill has been applied. Keeps the analyst on the
  // Intent step and lets the "next" action carry the AI-proposed skeleton
  // straight through instead of re-running the deterministic proposer
  // (which would clobber it). Reset when the delivers selection changes.
  const [aiApplied, setAiApplied] = useState(false)

  // AI assist
  const [aiOpen, setAiOpen] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiResult, setAiResult] = useState<AiCompose | null>(null)

  const [memberState, setMemberState] = useState<Record<string, MemberState>>({})
  const [gapState, setGapState] = useState<Record<string, GapState>>({})
  const [existingFlowOn, setExistingFlowOn] = useState<Record<string, boolean>>({})
  const [addedFlows, setAddedFlows] = useState<SolutionFlow[]>([])
  const [processes, setProcesses] = useState<SolutionProcess[]>([])
  const [proposal, setProposal] = useState<SolutionProposal | null>(null)

  // Manually added brand-new components (beyond the proposer's gaps).
  const [manualNew, setManualNew] = useState<{ name: string; type: ComponentType }[]>([])
  const [mnName, setMnName] = useState("")
  const [mnType, setMnType] = useState<ComponentType>("service")

  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/components")
      .then((r) => r.json())
      .then((d) => setComponents(Array.isArray(d) ? d : []))
      .catch(() => setComponents([]))
  }, [])

  // ----- draft persistence (don't lose work if the save fails / page
  // reloads / browser crashes). The whole wizard state is snapshotted to
  // localStorage on every change and restored on open; cleared only after
  // a successful create or an explicit "Start over". -----
  const DRAFT_KEY = "arch:solution-wizard-draft"
  const savedOnce = useRef(false)

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY)
    } catch {
      // ignore
    }
  }

  // Restore once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const d = JSON.parse(raw)
      if (typeof d !== "object" || d === null) return
      if (typeof d.name === "string") setName(d.name)
      if (typeof d.goal === "string") setGoal(d.goal)
      if (typeof d.owner === "string") setOwner(d.owner)
      if (typeof d.desc === "string") setDesc(d.desc)
      if (Array.isArray(d.selCaps)) setSelCaps(d.selCaps)
      if (d.proposal) setProposal(d.proposal)
      if (d.memberState) setMemberState(d.memberState)
      if (d.gapState) setGapState(d.gapState)
      if (Array.isArray(d.manualNew)) setManualNew(d.manualNew)
      if (d.existingFlowOn) setExistingFlowOn(d.existingFlowOn)
      if (Array.isArray(d.addedFlows)) setAddedFlows(d.addedFlows)
      if (Array.isArray(d.processes)) setProcesses(d.processes)
      if (d.sourceDoc && typeof d.sourceDoc.text === "string") setSourceDoc(d.sourceDoc)
      if (typeof d.aiApplied === "boolean") setAiApplied(d.aiApplied)
      if (typeof d.step === "number") setStep(d.step)
    } catch {
      // corrupt draft — ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Save on every change (skip the very first run so we don't overwrite a
  // restored draft with the initial empty state).
  useEffect(() => {
    if (!savedOnce.current) {
      savedOnce.current = true
      return
    }
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          step, name, goal, owner, desc, selCaps,
          proposal, memberState, gapState, manualNew, existingFlowOn, addedFlows,
          processes, sourceDoc, aiApplied,
        })
      )
    } catch {
      // quota / serialization issue — non-fatal
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, name, goal, owner, desc, selCaps, proposal, memberState, gapState, manualNew, existingFlowOn, addedFlows, processes, sourceDoc, aiApplied])

  const byId = useMemo(() => new Map(components.map((c) => [c.id, c])), [components])

  // Chip vocabularies — click, don't type.
  const allCaps = useMemo(() => {
    const s = new Set<string>(BUSINESS_CAPABILITIES as readonly string[])
    for (const c of components) for (const cap of c.capabilities || []) if (cap.name) s.add(cap.name)
    return Array.from(s).sort((a, b) => a.localeCompare(b))
  }, [components])

  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => {
    // Changing the delivers selection invalidates an AI-proposed skeleton:
    // the next "Propose skeleton" should re-run the deterministic proposer
    // from the new selection rather than carry the stale AI proposal.
    setAiApplied(false)
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])
  }

  // Run the deterministic proposer and seed selections.
  const runProposer = () => {
    const p = proposeSolution(
      // Processes are no longer a delivers axis — a process is now the
      // editable sequence. The proposer ranks members by capabilities only.
      { name, capabilities: selCaps, processes: [] },
      components
    )
    setProposal(p)
    const ms: Record<string, MemberState> = {}
    for (const m of p.members)
      ms[m.component] = { include: true, disposition: m.disposition, role: m.role || "", reason: m.reason }
    setMemberState(ms)
    const gs: Record<string, GapState> = {}
    for (const g of p.gaps)
      gs[g.value] = { include: true, name: g.suggestedName, type: g.suggestedType, kind: g.kind, value: g.value }
    setGapState(gs)
    const ef: Record<string, boolean> = {}
    for (const f of p.flows) ef[flowKey(f)] = true
    setExistingFlowOn(ef)
    setAddedFlows([])
  }

  const goStep2 = () => {
    // After an AI pre-fill the proposal/members are already populated;
    // re-running the deterministic proposer would discard them. Only
    // propose deterministically when no AI skeleton is in play.
    if (!aiApplied) runProposer()
    setStep(2)
  }

  // Upload source documentation → extract its text and keep it as a
  // separate AI context. The raw text is deliberately NOT written into the
  // description (that field stays the analyst's to write); it is used only
  // as grounding for AI pre-fill and goal extrapolation. The goal is
  // extrapolated from the document only when empty.
  const uploadBrd = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBrdBusy(true)
    setBrdError(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const r = await fetch("/api/extract-doc", { method: "POST", body: fd })
      const raw = await r.text()
      let d: { text?: string; error?: string } | null = null
      try {
        d = raw ? JSON.parse(raw) : null
      } catch {
        d = null
      }
      if (!r.ok || !d || typeof d.text !== "string") {
        throw new Error(
          (d && d.error) ||
            (r.status === 413 ? "Document too large." : `Upload failed (${r.status})`)
        )
      }
      const docText = d.text
      // Keep the document as standalone context; show it collapsed.
      setSourceDoc({ name: file.name, text: docText })
      setShowSource(false)
      // Extrapolate the goal ONLY when empty — never overwrite a typed goal.
      let goalIsEmpty = false
      setGoal((g) => {
        goalIsEmpty = g.trim() === ""
        return g
      })
      if (goalIsEmpty) {
        setGoalBusy(true)
        try {
          const gr = await fetch("/api/solutions/extrapolate-goal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: docText }),
          })
          const gd = await gr.json().catch(() => null)
          if (gr.ok && gd && typeof gd.goal === "string" && gd.goal.trim()) {
            // Guard against a race: if the analyst typed a goal while the
            // model was thinking, keep theirs.
            setGoal((g) => (g.trim() === "" ? gd.goal.trim() : g))
          }
        } finally {
          setGoalBusy(false)
        }
      }
    } catch (err) {
      setBrdError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setBrdBusy(false)
      if (brdInputRef.current) brdInputRef.current.value = ""
    }
  }

  // AI assist — call the LLM compose endpoint with the intent; on open.
  const runAi = async () => {
    setAiOpen(true)
    setAiLoading(true)
    setAiError(null)
    setAiResult(null)
    try {
      const r = await fetch("/api/solutions/ai-compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          goal,
          description: desc,
          sourceDoc: sourceDoc?.text || undefined,
        }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok) throw new Error((data && data.error) || `AI assist failed (${r.status})`)
      setAiResult(data as AiCompose)
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI assist failed")
    } finally {
      setAiLoading(false)
    }
  }

  // Apply the AI result into the wizard state. Stays on the Intent step
  // (no auto-jump) so the analyst can review the filled goal/description
  // and skeleton; `aiApplied` then carries the AI proposal through to
  // step 2 without re-running the deterministic proposer.
  const applyAi = (ai: AiCompose) => {
    // Non-destructive: only fill goal/description when still empty.
    if (typeof ai.goal === "string" && ai.goal.trim())
      setGoal((g) => (g.trim() ? g : ai.goal!.trim()))
    if (typeof ai.description === "string" && ai.description.trim())
      setDesc((dd) => (dd.trim() ? dd : ai.description!.trim()))

    setSelCaps(ai.delivers.capabilities || [])

    const members = (ai.members || []).map((m) => ({
      component: m.component,
      disposition: m.disposition,
      role: m.role,
      reason: "AI suggested",
    }))
    setProposal({ members, gaps: [], flows: [] })
    const ms: Record<string, MemberState> = {}
    for (const m of members)
      ms[m.component] = { include: true, disposition: m.disposition, role: m.role || "", reason: "AI suggested" }
    setMemberState(ms)
    setGapState({})

    setManualNew((ai.newComponents || []).map((n) => ({ name: n.name, type: n.type })))

    // Resolve flow endpoints: a new component may be referenced by name.
    const nameToId = new Map((ai.newComponents || []).map((n) => [n.name, slugifyId(n.name)]))
    const resolve = (x: string) => nameToId.get(x) || x
    setExistingFlowOn({})
    setAddedFlows(
      (ai.flows || []).map((f) => ({
        from: resolve(f.from),
        to: resolve(f.to),
        role: f.role,
        protocol: f.protocol,
        status: f.status,
      }))
    )

    // Seed a starter process sequence — only when the analyst hasn't added
    // any, so an AI re-run never clobbers hand-authored processes.
    if (ai.process) setProcesses((prev) => (prev.length === 0 ? [ai.process as SolutionProcess] : prev))

    setAiOpen(false)
    setAiApplied(true)
  }

  // ---- assembled solution (for preview + create) ----
  const assembled = useMemo(() => {
    const members: SolutionMember[] = []
    if (proposal) {
      for (const m of proposal.members) {
        const st = memberState[m.component]
        if (st?.include) members.push({ component: m.component, disposition: st.disposition, role: st.role || undefined })
      }
    }
    const newComponents: Component[] = []
    for (const key of Object.keys(gapState)) {
      const g = gapState[key]
      if (!g.include) continue
      const id = slugifyId(g.name)
      if (!id) continue
      members.push({ component: id, disposition: "new", role: `Covers ${g.kind} “${g.value}”` })
      newComponents.push({
        id,
        name: g.name,
        type: g.type,
        status: "draft",
        owner,
        tags: [],
        description: {},
        capabilities: g.kind === "capability" ? [{ name: g.value, role: "owner" }] : [],
        // Processes are no longer a component-level tag — a process is the
        // editable sequence on the solution. Never seed component.processes.
      })
    }
    // Manually added new components.
    for (const m of manualNew) {
      const id = slugifyId(m.name)
      if (!id) continue
      members.push({ component: id, disposition: "new", role: undefined })
      newComponents.push({
        id,
        name: m.name,
        type: m.type,
        status: "draft",
        owner,
        tags: [],
        description: {},
      })
    }

    // De-dupe by id (a manual add could collide with a gap or another).
    const seenM = new Set<string>()
    const uniqMembers = members.filter((m) => (seenM.has(m.component) ? false : (seenM.add(m.component), true)))
    const seenC = new Set<string>()
    const uniqNew = newComponents.filter((c) => (seenC.has(c.id) ? false : (seenC.add(c.id), true)))

    const flows: SolutionFlow[] = []
    if (proposal) for (const f of proposal.flows) if (existingFlowOn[flowKey(f)]) flows.push(stripReason(f))
    for (const f of addedFlows) flows.push(f)
    return { members: uniqMembers, newComponents: uniqNew, flows }
  }, [proposal, memberState, gapState, existingFlowOn, addedFlows, owner, manualNew])

  const previewChart = useMemo(() => {
    // Include gap "new" members as pseudo-components so the diagram labels them.
    const pseudo: Component[] = assembled.newComponents.map((c) => c)
    return buildSolutionMermaid(assembled.members, [...components, ...pseudo], assembled.flows)
  }, [assembled, components])

  // id → display name, covering existing + the about-to-be-created
  // components, so the review's sequence diagrams label their lifelines.
  const nameLookup = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of components) m.set(c.id, c.name)
    for (const c of assembled.newComponents) m.set(c.id, c.name)
    return m
  }, [components, assembled.newComponents])

  const create = async () => {
    setCreating(true)
    setCreateError(null)
    try {
      const id = slugifyId(name)
      if (!id) {
        throw new Error(
          "Could not derive an id from the name — use letters or digits in the solution name."
        )
      }
      const solution: Solution = {
        id,
        name,
        status: "draft",
        owner,
        description: desc ? { description: desc } : {},
        goal: goal || undefined,
        delivers: { capabilities: selCaps },
        members: assembled.members,
        flows: assembled.flows,
        processes,
      }
      const r = await fetch("/api/solutions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ solution, newComponents: assembled.newComponents }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok) throw new Error((data && data.error) || `Create failed (${r.status})`)
      if (!data || typeof data.id !== "string") {
        throw new Error("The server didn't confirm the save. Your work is kept here — try again.")
      }
      // Persist the uploaded source document (BRD) on the new solution so it
      // is reused for DSD generation — no need to upload it again. Best-effort.
      if (sourceDoc?.text?.trim()) {
        try {
          await fetch(`/api/solutions/${encodeURIComponent(data.id)}/source-docs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: sourceDoc.name, text: sourceDoc.text }),
          })
        } catch {
          // non-fatal — the solution is created; the doc can be re-added later
        }
      }
      clearDraft()
      router.push(`/solutions/${encodeURIComponent(data.id)}`)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Create failed")
      setCreating(false)
    }
  }

  const memberIdsForFlow = assembled.members.map((m) => m.component)

  // Ordering controls for the manually-added flows, mirroring the solution
  // editor: a one-click A–Z sort and per-row up/down. Sorting groups
  // duplicates adjacently (the analyst's reported pain) and the order is
  // preserved into the saved flow list and the live diagram.
  const flowSortKey = (f: SolutionFlow) =>
    `${labelFor(f.from, byId, assembled.newComponents)}→${labelFor(f.to, byId, assembled.newComponents)}`
  const sortAddedFlows = () =>
    setAddedFlows((a) => [...a].sort((x, y) => flowSortKey(x).localeCompare(flowSortKey(y))))
  const moveAddedFlow = (i: number, dir: -1 | 1) =>
    setAddedFlows((a) => {
      const j = i + dir
      if (j < 0 || j >= a.length) return a
      const next = [...a]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center gap-2">
        <Link href="/solutions">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">New solution</h1>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          onClick={() => {
            clearDraft()
            window.location.reload()
          }}
          title="Discard this draft and start a blank solution"
        >
          Start over
        </Button>
        <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          {["Intent", "Skeleton", "Flows", "Processes", "Review"].map((label, i) => (
            <span
              key={label}
              className={`px-2 py-1 rounded ${step === i + 1 ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              {i + 1}. {label}
            </span>
          ))}
        </div>
      </div>

      {/* Two-column: the wizard on the left, an always-visible live preview
          on the right that sticks while scrolling. Stacks on narrow screens
          (preview drops below). */}
      <div className="grid gap-6 items-start lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <div className="space-y-6 min-w-0">
      {/* STEP 1 — intent */}
      {step === 1 && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-medium">Name *</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer Self-Service Portal" />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Owner</span>
              <Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="digital-team" />
            </label>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-sm font-medium flex items-center gap-1.5">
                Goal
                {goalBusy && (
                  <span className="text-xs font-normal text-muted-foreground flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> extrapolating from document…
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <input
                  ref={brdInputRef}
                  type="file"
                  accept=".pdf,.txt,.md,text/plain,application/pdf"
                  onChange={uploadBrd}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => brdInputRef.current?.click()}
                  disabled={brdBusy}
                >
                  {brdBusy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5 mr-1.5" />}
                  Upload source documentation
                </Button>
              </div>
            </div>
            <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Reduce inbound support by 30%" />
            {brdError && <p className="text-xs text-red-700">{brdError}</p>}
          </div>

          {/* Uploaded source documentation — kept only as AI context, never
              written to the saved solution. Collapsible, removable. */}
          {sourceDoc && (
            <div className="rounded-md border bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm flex items-center gap-1.5 min-w-0">
                  <FileUp className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                  <span className="font-medium truncate">{sourceDoc.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">· used as AI context</span>
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowSource((v) => !v)}>
                    {showSource ? "Hide" : "View text"}
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-600" title="Remove" onClick={() => { setSourceDoc(null); setShowSource(false) }}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Stays with this draft and feeds AI pre-fill — it is not saved into the solution.
              </p>
              {showSource && (
                <pre className="max-h-48 overflow-auto rounded bg-background border p-2 text-xs whitespace-pre-wrap">{sourceDoc.text}</pre>
              )}
            </div>
          )}

          <label className="space-y-1 block">
            <span className="text-sm font-medium">Description</span>
            <Textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={4}
              placeholder="Describe what the solution should do, who uses it, and what it touches. The richer this is, the better AI assist can pre-fill the rest — or let AI draft this for you."
            />
          </label>

          <div className="rounded-md border bg-muted/20 p-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm">
              <span className="font-medium flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-blue-600" />
                AI assist
              </span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Give it a name (and optionally a goal, description or source document), then let AI
                pre-fill the goal, description, delivers, members and flows from the catalog. Anything
                you&apos;ve already filled is kept.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={runAi}
              disabled={!name.trim()}
              title={!name.trim() ? "Enter a name first" : undefined}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Pre-fill with AI
            </Button>
          </div>

          {aiApplied && (
            <div className="rounded-md border border-green-300 bg-green-50 p-2.5 text-xs text-green-900 flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              AI pre-fill applied — review the goal, description and delivers, then continue.
            </div>
          )}

          <ChipPicker title="Delivers — capabilities" options={allCaps} selected={selCaps} onToggle={(v) => toggle(selCaps, setSelCaps, v)} />

          <div className="flex justify-end">
            <Button
              onClick={goStep2}
              disabled={name.trim() === "" || (!aiApplied && selCaps.length === 0)}
            >
              {aiApplied ? "Continue to skeleton →" : "Propose skeleton →"}
            </Button>
          </div>
        </div>
      )}

      {/* STEP 2 — skeleton */}
      {step === 2 && proposal && (
        <div className="space-y-5">
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              A solution only wires components together. To define a component&apos;s
              detailed functionality — logic, rules, NFR, capabilities, processes —
              open that component and edit it there. New components added here are
              created as empty drafts for you to flesh out afterwards.
            </span>
          </div>
          <section>
            <h2 className="text-sm font-semibold mb-2">Proposed members ({proposal.members.length})</h2>
            {proposal.members.length === 0 && <p className="text-sm text-muted-foreground">No existing component covers the selected targets — see gaps below.</p>}
            <div className="space-y-2">
              {proposal.members.map((m) => {
                const st = memberState[m.component]
                const c = byId.get(m.component)
                return (
                  <Card key={m.component}>
                    <CardContent className="py-3">
                      <div className="flex items-start gap-3">
                        <input type="checkbox" className="mt-1 h-4 w-4" checked={st?.include ?? false}
                          onChange={(e) => setMemberState((s) => ({ ...s, [m.component]: { ...st, include: e.target.checked } }))} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{c?.name || m.component}</span>
                            <Seg value={st?.disposition} onChange={(d) => setMemberState((s) => ({ ...s, [m.component]: { ...st, disposition: d } }))} />
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{m.reason}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold mb-2">Gaps → new components ({proposal.gaps.length})</h2>
            {proposal.gaps.length === 0 && <p className="text-sm text-muted-foreground">All targets are covered by existing components.</p>}
            <div className="space-y-2">
              {proposal.gaps.map((g) => {
                const st = gapState[g.value]
                return (
                  <Card key={g.value}>
                    <CardContent className="py-3 flex items-start gap-3">
                      <input type="checkbox" className="mt-2 h-4 w-4" checked={st?.include ?? false}
                        onChange={(e) => setGapState((s) => ({ ...s, [g.value]: { ...st, include: e.target.checked } }))} />
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="text-xs text-muted-foreground">
                          gap: {g.kind} “{g.value}” not covered → new component
                        </div>
                        <div className="flex gap-2 flex-wrap items-center">
                          <Input className="h-8 w-64" value={st?.name ?? ""} onChange={(e) => setGapState((s) => ({ ...s, [g.value]: { ...st, name: e.target.value } }))} />
                          <select className="h-8 rounded-md border bg-background px-2 text-sm" value={st?.type}
                            onChange={(e) => setGapState((s) => ({ ...s, [g.value]: { ...st, type: e.target.value as ComponentType } }))}>
                            {["service", "microservice", "component", "frontend", "gateway", "database"].map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <Badge variant="outline" className="text-[10px]">id: {slugifyId(st?.name || "")}</Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold mb-2">Add a new component ({manualNew.length})</h2>
            <p className="text-xs text-muted-foreground mb-2">
              Create a brand-new component for this solution. It will be added to the catalog as a draft on Create, and is then available everywhere — including the link editor.
            </p>
            <div className="flex flex-wrap gap-2 items-center">
              <Input
                className="h-8 w-64"
                value={mnName}
                onChange={(e) => setMnName(e.target.value)}
                placeholder="Component name"
              />
              <select
                className="h-8 rounded-md border bg-background px-2 text-sm"
                value={mnType}
                onChange={(e) => setMnType(e.target.value as ComponentType)}
              >
                {["service", "microservice", "component", "frontend", "gateway", "database", "queue", "library"].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={mnName.trim() === ""}
                onClick={() => {
                  setManualNew((a) => [...a, { name: mnName.trim(), type: mnType }])
                  setMnName("")
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add
              </Button>
            </div>
            {manualNew.length > 0 && (
              <div className="space-y-1 mt-2">
                {manualNew.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <Badge variant="outline" className="text-[10px]">new</Badge>
                    <span className="font-medium">{m.name}</span>
                    <span className="text-xs text-muted-foreground">· {m.type}</span>
                    <Badge variant="outline" className="text-[10px]">id: {slugifyId(m.name)}</Badge>
                    <button onClick={() => setManualNew((a) => a.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-red-600">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
            <Button onClick={() => setStep(3)}>Flows →</Button>
          </div>
        </div>
      )}

      {/* STEP 3 — flows */}
      {step === 3 && proposal && (
        <div className="space-y-5">
          <section>
            <h2 className="text-sm font-semibold mb-2">Existing links between members</h2>
            {proposal.flows.length === 0 && <p className="text-sm text-muted-foreground">No existing links between the chosen members.</p>}
            <div className="space-y-2">
              {proposal.flows.map((f) => (
                <label key={flowKey(f)} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={existingFlowOn[flowKey(f)] ?? false}
                    onChange={(e) => setExistingFlowOn((s) => ({ ...s, [flowKey(f)]: e.target.checked }))} />
                  <span>{byId.get(f.from)?.name || f.from} → {byId.get(f.to)?.name || f.to}</span>
                  <Badge variant="outline" className="text-[10px]">{f.role}{f.protocol ? ` · ${f.protocol}` : ""}</Badge>
                </label>
              ))}
            </div>
          </section>

          <FlowAdder memberIds={memberIdsForFlow} byId={byId} newNames={assembled.newComponents} onAdd={(f) => setAddedFlows((a) => [...a, f])} />

          {addedFlows.length > 0 && (
            <section>
              <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                <h2 className="text-sm font-semibold">Proposed flows ({addedFlows.length})</h2>
                {addedFlows.length > 1 && (
                  <Button size="sm" variant="outline" onClick={sortAddedFlows}>
                    <ArrowDownAZ className="h-3.5 w-3.5 mr-1" />Sort A–Z
                  </Button>
                )}
              </div>
              <div className="space-y-1">
                {addedFlows.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <button disabled={i === 0} onClick={() => moveAddedFlow(i, -1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Move up"><ChevronUp className="h-3.5 w-3.5" /></button>
                    <button disabled={i === addedFlows.length - 1} onClick={() => moveAddedFlow(i, 1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Move down"><ChevronDown className="h-3.5 w-3.5" /></button>
                    <span>{labelFor(f.from, byId, assembled.newComponents)} ⇢ {labelFor(f.to, byId, assembled.newComponents)}</span>
                    <Badge variant="outline" className="text-[10px]">{f.role}{f.protocol ? ` · ${f.protocol}` : ""}</Badge>
                    <button onClick={() => setAddedFlows((a) => a.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-red-600">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>← Back</Button>
            <Button onClick={() => setStep(4)}>Processes →</Button>
          </div>
        </div>
      )}

      {/* STEP 4 — process sequences */}
      {step === 4 && (
        <div className="space-y-5">
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Optional — document how the solution runs a process, step by step (actor →
              target). Renders as a sequence diagram and grounds the generated DSD. You can
              also add these later from the solution editor.
            </span>
          </div>
          <ProcessesEditor
            processes={processes}
            onChange={setProcesses}
            members={assembled.members.map((m) => ({
              id: m.component,
              name: labelFor(m.component, byId, assembled.newComponents),
            }))}
            onAiDraft={async (processName) => {
              const r = await fetch("/api/solutions/process-draft", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  processName,
                  name,
                  goal,
                  description: desc,
                  members: buildProcessDraftMembers(
                    assembled.members,
                    (id) => byId.get(id) || assembled.newComponents.find((n) => n.id === id)
                  ),
                  flows: assembled.flows.map((f) => ({ from: f.from, to: f.to, role: f.role, protocol: f.protocol })),
                  sourceDoc: sourceDoc?.text || undefined,
                }),
              })
              const d = await r.json().catch(() => null)
              if (!r.ok) {
                setCreateError((d && d.error) || "AI draft failed")
                return null
              }
              return d
            }}
          />
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(3)}>← Back</Button>
            <Button onClick={() => setStep(5)}>Review →</Button>
          </div>
        </div>
      )}

      {/* STEP 5 — review */}
      {step === 5 && (
        <div className="space-y-5">
          {/* Overview header — the solution's identity at a glance. */}
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{name.trim() || "Untitled solution"}</h2>
            <p className="text-xs text-muted-foreground">
              {owner ? <>Owner: <span className="font-medium">{owner}</span> · </> : null}
              draft · {assembled.members.length} member(s)
            </p>
            {goal.trim() && (
              <p className="text-sm pt-1">
                <span className="font-medium">Goal:</span> {goal.trim()}
              </p>
            )}
            {desc.trim() && (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{desc.trim()}</p>
            )}
          </div>

          {/* Count strip. */}
          <div className="flex flex-wrap gap-2">
            {[
              [assembled.members.length, "members"],
              [assembled.newComponents.length, "new to create"],
              [assembled.flows.length, "flows"],
              [processes.length, "processes"],
              [selCaps.length, "capabilities"],
            ].map(([n, label]) => (
              <Badge key={label as string} variant="secondary" className="text-xs font-normal">
                <span className="font-semibold mr-1">{n}</span>
                {label}
              </Badge>
            ))}
          </div>

          {/* Delivered capabilities. */}
          {selCaps.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="text-sm font-semibold">Delivers — capabilities</h3>
              <div className="flex flex-wrap gap-1.5">
                {selCaps.map((c) => (
                  <Badge key={c} variant="outline" className="text-xs font-normal">{c}</Badge>
                ))}
              </div>
            </section>
          )}

          {/* Members. */}
          {assembled.members.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="text-sm font-semibold">Members ({assembled.members.length})</h3>
              <div className="rounded-md border divide-y">
                {assembled.members.map((m) => {
                  const isNew = m.disposition === "new"
                  return (
                    <div key={m.component} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="font-medium truncate">{nameLookup.get(m.component) || m.component}</span>
                      <Badge variant={isNew ? "default" : "outline"} className="text-[10px] shrink-0">
                        {isNew ? "new" : MEMBER_DISPOSITION_LABELS[m.disposition]}
                      </Badge>
                      {m.role && <span className="text-xs text-muted-foreground truncate">· {m.role}</span>}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Flows. */}
          {assembled.flows.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="text-sm font-semibold">Flows ({assembled.flows.length})</h3>
              <div className="space-y-1">
                {assembled.flows.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span>{nameLookup.get(f.from) || f.from} → {nameLookup.get(f.to) || f.to}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {f.role}{f.protocol ? ` · ${f.protocol}` : ""}
                    </Badge>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Architecture diagram. */}
          <section className="space-y-1.5">
            <h3 className="text-sm font-semibold">Architecture</h3>
            <div className="rounded-md border p-2">
              <MermaidPreview
                chart={previewChart}
                className="w-full"
                zoomable
                expandable
                expandTitle={`${name.trim() || "Solution"} — architecture`}
                height={360}
              />
            </div>
          </section>

          {/* Process sequence diagram(s). */}
          {processes.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="text-sm font-semibold">
                Process {processes.length > 1 ? "sequences" : "sequence"} ({processes.length})
              </h3>
              <div className="space-y-3">
                {processes.map((p, i) => (
                  <div key={i} className="rounded-md border p-2 space-y-1">
                    <div className="text-xs font-medium text-muted-foreground px-1">
                      {p.name?.trim() || `Process ${i + 1}`}
                    </div>
                    <MermaidPreview
                      chart={buildSolutionSequenceMermaid(p, nameLookup)}
                      className="w-full"
                      zoomable
                      expandable
                      expandTitle={`${p.name?.trim() || "Process"} — sequence`}
                      height={320}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* A name is required to save. The AI-assist path can reach this
              step without one, so let the analyst fix it right here instead
              of leaving the Create button mysteriously greyed out. */}
          {name.trim() === "" && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2">
              <div className="text-sm text-amber-900 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                Your solution needs a <strong>name</strong> before it can be created.
              </div>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Solution name"
                className="max-w-sm bg-white"
                autoFocus
              />
            </div>
          )}

          {createError && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />{createError}
            </div>
          )}
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(4)} disabled={creating}>← Back</Button>
            <Button onClick={create} disabled={creating || name.trim() === ""}>
              {creating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating…</> : "Create solution"}
            </Button>
          </div>
        </div>
      )}
        </div>

        {/* Persistent live preview — visible in every step so the analyst
            sees the solution diagram update as they pick members and wire
            flows, instead of only at the final review. Sticky so it stays
            on screen. Empty until members exist (the builder renders a
            "No members yet" placeholder). */}
        <div className="min-w-0">
          <Card className="lg:sticky lg:top-4">
            <CardContent className="pt-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Live preview</span>
                <span className="text-xs text-muted-foreground">
                  {assembled.members.length} members · {assembled.flows.length} flows
                </span>
              </div>
              <MermaidPreview
                chart={previewChart}
                className="w-full"
                zoomable
                expandable
                expandTitle="Solution preview"
                height={340}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <AgentRunModal
        open={aiLoading}
        title="Solution composer"
        nodes={[{ label: "Solution composer", icon: "🧠" }]}
        stages={[
          "Reading your intent and any source document…",
          "Scanning the component catalog for reuse…",
          "Selecting members and wiring the flows…",
          "Drafting the goal, description and a starter process…",
        ]}
      />

      <Dialog open={aiOpen && !aiLoading} onOpenChange={setAiOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-blue-600" />
              AI assist
            </DialogTitle>
            <DialogDescription>
              Reads your name, any goal/description/source document and the whole
              catalog, then proposes the rest of the solution (filling an empty
              goal/description too). Review the summary, then apply.
            </DialogDescription>
          </DialogHeader>

          {aiLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
              Thinking… reading the catalog and composing.
            </div>
          )}
          {!aiLoading && aiError && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {aiError}
            </div>
          )}
          {!aiLoading && !aiError && aiResult && (
            <div className="space-y-2 text-sm">
              <p>AI proposes:</p>
              <ul className="list-disc pl-5 space-y-0.5">
                <li>{aiResult.delivers.capabilities.length} capabilities</li>
                <li>{aiResult.members.length} existing component(s) to reuse/extend</li>
                <li>{aiResult.newComponents.length} new component(s) to create</li>
                <li>{aiResult.flows.length} flow(s)</li>
                {aiResult.process && <li>1 starter process sequence</li>}
              </ul>
              {aiResult.members.length === 0 && aiResult.newComponents.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nothing concrete matched — try a richer description.
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setAiOpen(false)} disabled={aiLoading}>
              Cancel
            </Button>
            {!aiLoading && !aiError && aiResult && (
              <Button onClick={() => applyAi(aiResult)}>Apply</Button>
            )}
            {!aiLoading && aiError && (
              <Button onClick={runAi}>Retry</Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---- helpers / sub-components ----

function flowKey(f: SolutionFlow): string {
  return `${f.from}::${f.to}::${f.role}::${f.protocol ?? ""}`
}
function stripReason(f: SolutionFlow): SolutionFlow {
  return { from: f.from, to: f.to, role: f.role, protocol: f.protocol, status: f.status, description: f.description }
}
function labelFor(id: string, byId: Map<string, Component>, news: Component[]): string {
  return byId.get(id)?.name || news.find((n) => n.id === id)?.name || id
}

function Seg({ value, onChange }: { value?: MemberDisposition; onChange: (d: MemberDisposition) => void }) {
  return (
    <div className="flex gap-0.5 rounded-md border p-0.5">
      {MEMBER_DISPOSITIONS.filter((d) => d !== "new").map((d) => (
        <button key={d} type="button" onClick={() => onChange(d)}
          className={`px-2 py-0.5 rounded text-[11px] font-medium ${value === d ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
          {MEMBER_DISPOSITION_LABELS[d]}
        </button>
      ))}
    </div>
  )
}

function FlowAdder({ memberIds, byId, newNames, onAdd }: {
  memberIds: string[]; byId: Map<string, Component>; newNames: Component[]; onAdd: (f: SolutionFlow) => void
}) {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [role, setRole] = useState<LinkRole>("calls")
  const [protocol, setProtocol] = useState<LinkProtocol | "">("rest")
  const label = (id: string) => byId.get(id)?.name || newNames.find((n) => n.id === id)?.name || id
  return (
    <section className="rounded-md border p-3 space-y-2 bg-muted/20">
      <h3 className="text-sm font-medium flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> Add proposed flow</h3>
      <div className="flex flex-wrap gap-2 items-center text-sm">
        <select className="h-8 rounded-md border bg-background px-2" value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">from…</option>
          {memberIds.map((id) => <option key={id} value={id}>{label(id)}</option>)}
        </select>
        <span>→</span>
        <select className="h-8 rounded-md border bg-background px-2" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">to…</option>
          {memberIds.map((id) => <option key={id} value={id}>{label(id)}</option>)}
        </select>
        <select className="h-8 rounded-md border bg-background px-2" value={role} onChange={(e) => setRole(e.target.value as LinkRole)}>
          {LINK_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="h-8 rounded-md border bg-background px-2" value={protocol} onChange={(e) => setProtocol(e.target.value as LinkProtocol | "")}>
          <option value="">(no protocol)</option>
          {LINK_PROTOCOLS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <Button size="sm" variant="outline" disabled={!from || !to || from === to}
          onClick={() => { onAdd({ from, to, role, protocol: protocol || undefined, status: "proposed" }); setFrom(""); setTo("") }}>
          Add
        </Button>
      </div>
    </section>
  )
}
