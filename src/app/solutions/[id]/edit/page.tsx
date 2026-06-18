"use client"

// Solution editor — edit an existing solution's details, delivers,
// members and flows. New "new"-disposition members typed here are
// created as draft components in the catalog on save (so they become
// usable in the link editor too). Saves via PUT with the loaded sha.

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ArrowLeft, Loader2, AlertCircle, Plus, X, Save, Info, ArrowDownAZ, Eye, EyeOff, ChevronUp, ChevronDown } from "lucide-react"
import { ChipPicker } from "@/components/ChipPicker"
import { MermaidPreview } from "@/components/mermaid-preview"
import { ProcessesEditor } from "@/components/ProcessesEditor"
import { buildSolutionMermaid } from "@/lib/architecture-mermaid"
import { slugifyId } from "@/lib/component-schema"
import {
  BUSINESS_CAPABILITIES,
  SOLUTION_STATUSES,
  MEMBER_DISPOSITIONS,
  MEMBER_DISPOSITION_LABELS,
  LINK_ROLES,
  LINK_PROTOCOLS,
} from "@/lib/constants"
import type {
  Component,
  ComponentType,
  SolutionFlow,
  SolutionMember,
  SolutionProcess,
  SolutionStatus,
  SolutionWithSha,
  LinkRole,
  LinkProtocol,
} from "@/lib/types"

type EditTab = "details" | "delivers" | "members" | "flows" | "processes"
const EDIT_TABS: { id: EditTab; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "delivers", label: "Delivers" },
  { id: "members", label: "Members" },
  { id: "flows", label: "Flows" },
  { id: "processes", label: "Processes" },
]

export default function EditSolutionPage() {
  const params = useParams()
  const id = decodeURIComponent(String(params.id))
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [components, setComponents] = useState<Component[]>([])

  const [sha, setSha] = useState<string>("")
  const [name, setName] = useState("")
  const [status, setStatus] = useState<SolutionStatus>("draft")
  const [owner, setOwner] = useState("")
  const [goal, setGoal] = useState("")
  const [desc, setDesc] = useState("")
  const [caps, setCaps] = useState<string[]>([])
  const [members, setMembers] = useState<SolutionMember[]>([])
  const [flows, setFlows] = useState<SolutionFlow[]>([])
  const [processes, setProcesses] = useState<SolutionProcess[]>([])
  // brand-new components added during this edit (id -> name/type)
  const [pendingNew, setPendingNew] = useState<Record<string, { name: string; type: ComponentType }>>({})
  // preserved untouched fields
  const [nfr, setNfr] = useState<SolutionWithSha["nfr"]>(undefined)
  const [risks, setRisks] = useState<string[] | undefined>(undefined)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [tab, setTab] = useState<EditTab>("details")

  const [addExisting, setAddExisting] = useState("")
  const [mnName, setMnName] = useState("")
  const [mnType, setMnType] = useState<ComponentType>("service")

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/solutions/${encodeURIComponent(id)}`).then(async (r) => {
        const d = await r.json().catch(() => null)
        if (!r.ok) throw new Error((d && d.error) || `Not found (${r.status})`)
        return d as SolutionWithSha
      }),
      fetch("/api/components").then(async (r) => {
        const d = await r.json().catch(() => null)
        return Array.isArray(d) ? (d as Component[]) : []
      }),
    ])
      .then(([s, comps]) => {
        setComponents(comps)
        setSha(s.sha)
        setName(s.name)
        setStatus(s.status || "draft")
        setOwner(s.owner || "")
        setGoal(s.goal || "")
        setDesc(s.description?.description || "")
        setCaps(s.delivers?.capabilities || [])
        setMembers(s.members || [])
        setFlows(s.flows || [])
        setProcesses(s.processes || [])
        setNfr(s.nfr)
        setRisks(s.risks)
      })
      .catch((e: Error) => setError(e.message || "Failed to load"))
      .finally(() => setLoading(false))
  }, [id])

  const byId = useMemo(() => new Map(components.map((c) => [c.id, c])), [components])
  const label = (cid: string) => byId.get(cid)?.name || pendingNew[cid]?.name || cid

  const allCaps = useMemo(() => {
    const s = new Set<string>(BUSINESS_CAPABILITIES as readonly string[])
    for (const c of components) for (const cap of c.capabilities || []) if (cap.name) s.add(cap.name)
    return Array.from(s).sort((a, b) => a.localeCompare(b))
  }, [components])

  const toggle = (arr: string[], set: (v: string[]) => void, v: string) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  const [showFlowViz, setShowFlowViz] = useState(false)
  const moveFlow = (index: number, dir: -1 | 1) =>
    setFlows((fl) => {
      const arr = [...fl]
      const j = index + dir
      if (j < 0 || j >= arr.length) return fl
      ;[arr[index], arr[j]] = [arr[j], arr[index]]
      return arr
    })

  const updateMember = (i: number, patch: Partial<SolutionMember>) =>
    setMembers((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)))
  const removeMember = (i: number) => setMembers((ms) => ms.filter((_, j) => j !== i))

  const memberIds = members.map((m) => m.component)
  const addableExisting = components.filter((c) => !memberIds.includes(c.id))

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      // 1. create any brand-new components not yet in the catalog
      for (const [cid, meta] of Object.entries(pendingNew)) {
        if (byId.has(cid)) continue
        const r = await fetch("/api/components", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: cid, name: meta.name, type: meta.type, status: "draft", owner, tags: [], description: {},
          }),
        })
        if (!r.ok) {
          const d = await r.json().catch(() => null)
          throw new Error((d && d.error) || `Failed to create component ${cid}`)
        }
      }
      // 2. save the solution
      const body = {
        schema_version: 1,
        id,
        name,
        status,
        owner,
        description: desc ? { description: desc } : {},
        goal: goal || undefined,
        delivers: { capabilities: caps },
        members,
        flows,
        processes,
        nfr,
        risks,
        sha,
      }
      const r = await fetch(`/api/solutions/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error((d && d.error) || `Save failed (${r.status})`)
      router.push(`/solutions/${encodeURIComponent(id)}`)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed")
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-12">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    )
  }
  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/solutions"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Solutions</Button></Link>
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />{error}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-2">
        <Link href={`/solutions/${encodeURIComponent(id)}`}>
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <h1 className="text-2xl font-bold">Edit solution</h1>
        <div className="ml-auto flex gap-2">
          <Link href={`/solutions/${encodeURIComponent(id)}`}>
            <Button variant="outline" disabled={saving}>Cancel</Button>
          </Link>
          <Button onClick={save} disabled={saving || name.trim() === ""}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : <><Save className="h-4 w-4 mr-2" />Save</>}
          </Button>
        </div>
      </div>

      {saveError && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />{saveError}
        </div>
      )}

      {/* tab nav */}
      <div className="flex items-center gap-1 border-b overflow-x-auto">
        {EDIT_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${
              tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {t.id === "members" && members.length > 0 && <span className="ml-1 text-xs text-muted-foreground">({members.length})</span>}
            {t.id === "flows" && flows.length > 0 && <span className="ml-1 text-xs text-muted-foreground">({flows.length})</span>}
            {t.id === "processes" && processes.length > 0 && <span className="ml-1 text-xs text-muted-foreground">({processes.length})</span>}
          </button>
        ))}
      </div>

      {/* details */}
      {tab === "details" && (
      <section className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 sm:col-span-2">
            <span className="text-sm font-medium">Name *</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">Status</span>
            <select className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={status}
              onChange={(e) => setStatus(e.target.value as SolutionStatus)}>
              {SOLUTION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium">Owner</span>
            <Input value={owner} onChange={(e) => setOwner(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">Goal</span>
            <Input value={goal} onChange={(e) => setGoal(e.target.value)} />
          </label>
        </div>
        <label className="space-y-1 block">
          <span className="text-sm font-medium">Description</span>
          <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} />
        </label>
      </section>
      )}

      {tab === "delivers" && (
        <div className="space-y-4">
          <ChipPicker title="Delivers — capabilities" options={allCaps} selected={caps} onToggle={(v) => toggle(caps, setCaps, v)} />
        </div>
      )}

      {/* members */}
      {tab === "members" && (
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Members ({members.length})</h2>
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Here you only wire components into the solution. A component&apos;s
            detailed functionality — logic, rules, NFR, capabilities, processes —
            is edited on the component itself, not here.
          </span>
        </div>
        {members.map((m, i) => (
          <Card key={`${m.component}-${i}`}>
            <CardContent className="py-3 flex items-center gap-2 flex-wrap">
              <span className="font-medium min-w-[10rem]">{label(m.component)}</span>
              <div className="flex gap-0.5 rounded-md border p-0.5">
                {MEMBER_DISPOSITIONS.map((d) => (
                  <button key={d} type="button" onClick={() => updateMember(i, { disposition: d })}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium ${m.disposition === d ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                    {MEMBER_DISPOSITION_LABELS[d]}
                  </button>
                ))}
              </div>
              <Input className="h-8 flex-1 min-w-[12rem]" value={m.role || ""} placeholder="role in solution"
                onChange={(e) => updateMember(i, { role: e.target.value || undefined })} />
              <button onClick={() => removeMember(i)} className="text-muted-foreground hover:text-red-600"><X className="h-4 w-4" /></button>
            </CardContent>
          </Card>
        ))}

        <div className="flex flex-wrap gap-2 items-center rounded-md border p-3 bg-muted/20">
          <span className="text-xs font-medium">Add existing:</span>
          <select className="h-8 rounded-md border bg-background px-2 text-sm" value={addExisting} onChange={(e) => setAddExisting(e.target.value)}>
            <option value="">component…</option>
            {addableExisting.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <Button type="button" size="sm" variant="outline" disabled={!addExisting}
            onClick={() => { setMembers((ms) => [...ms, { component: addExisting, disposition: "reuse" }]); setAddExisting("") }}>
            Add
          </Button>
          <span className="mx-2 h-4 w-px bg-border" />
          <span className="text-xs font-medium">Add new:</span>
          <Input className="h-8 w-48" value={mnName} placeholder="name" onChange={(e) => setMnName(e.target.value)} />
          <select className="h-8 rounded-md border bg-background px-2 text-sm" value={mnType} onChange={(e) => setMnType(e.target.value as ComponentType)}>
            {["service", "microservice", "component", "frontend", "gateway", "database", "queue", "library"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <Button type="button" size="sm" variant="outline" disabled={mnName.trim() === ""}
            onClick={() => {
              const cid = slugifyId(mnName)
              if (!cid) return
              setPendingNew((p) => ({ ...p, [cid]: { name: mnName.trim(), type: mnType } }))
              setMembers((ms) => [...ms, { component: cid, disposition: "new" }])
              setMnName("")
            }}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add new
          </Button>
        </div>
      </section>
      )}

      {/* flows */}
      {tab === "flows" && (
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-semibold">Flows ({flows.length})</h2>
          <div className="flex gap-2">
            {flows.length > 1 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setFlows((fl) =>
                    [...fl].sort((a, b) =>
                      `${label(a.from)}→${label(a.to)}`.localeCompare(`${label(b.from)}→${label(b.to)}`)
                    )
                  )
                }
              >
                <ArrowDownAZ className="h-3.5 w-3.5 mr-1" />Sort A–Z
              </Button>
            )}
            {flows.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setShowFlowViz((v) => !v)}>
                {showFlowViz ? <EyeOff className="h-3.5 w-3.5 mr-1" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
                {showFlowViz ? "Hide" : "Preview"}
              </Button>
            )}
          </div>
        </div>
        {flows.map((f, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <button disabled={i === 0} onClick={() => moveFlow(i, -1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Move up"><ChevronUp className="h-3.5 w-3.5" /></button>
            <button disabled={i === flows.length - 1} onClick={() => moveFlow(i, 1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Move down"><ChevronDown className="h-3.5 w-3.5" /></button>
            <span>{label(f.from)} {f.status === "proposed" ? "⇢" : "→"} {label(f.to)}</span>
            <Badge variant="outline" className="text-[10px]">{f.role}{f.protocol ? ` · ${f.protocol}` : ""}</Badge>
            <Badge variant="outline" className={`text-[10px] ${f.status === "proposed" ? "text-blue-700 border-blue-300" : "text-muted-foreground"}`}>{f.status}</Badge>
            <button onClick={() => setFlows((fl) => fl.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        {showFlowViz && flows.length > 0 && (
          <div className="border rounded-md p-2 mt-2">
            <p className="text-xs text-muted-foreground mb-1">Live preview — updates as you edit.</p>
            <MermaidPreview chart={buildSolutionMermaid(members, components, flows)} className="w-full" />
          </div>
        )}
        <FlowAdder memberIds={memberIds} label={label} onAdd={(f) => setFlows((fl) => [...fl, f])} />
      </section>
      )}

      {/* process sequences */}
      {tab === "processes" && (
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Process sequences</h2>
        <ProcessesEditor
          processes={processes}
          onChange={setProcesses}
          members={members.map((m) => ({ id: m.component, name: label(m.component) }))}
          onAiDraft={async (processName) => {
            const r = await fetch("/api/solutions/process-draft", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                processName,
                name,
                goal,
                description: desc,
                members: members.map((m) => ({ id: m.component, name: label(m.component) })),
                flows: flows.map((f) => ({ from: f.from, to: f.to, role: f.role, protocol: f.protocol })),
              }),
            })
            const d = await r.json().catch(() => null)
            if (!r.ok) {
              setSaveError((d && d.error) || "AI draft failed")
              return null
            }
            return d
          }}
        />
      </section>
      )}
    </div>
  )
}

function FlowAdder({ memberIds, label, onAdd }: {
  memberIds: string[]; label: (id: string) => string; onAdd: (f: SolutionFlow) => void
}) {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [role, setRole] = useState<LinkRole>("calls")
  const [protocol, setProtocol] = useState<LinkProtocol | "">("rest")
  const [fstatus, setFstatus] = useState<"existing" | "proposed">("proposed")
  return (
    <div className="flex flex-wrap gap-2 items-center rounded-md border p-3 bg-muted/20">
      <Plus className="h-3.5 w-3.5" />
      <select className="h-8 rounded-md border bg-background px-2 text-sm" value={from} onChange={(e) => setFrom(e.target.value)}>
        <option value="">from…</option>
        {memberIds.map((id) => <option key={id} value={id}>{label(id)}</option>)}
      </select>
      <span>→</span>
      <select className="h-8 rounded-md border bg-background px-2 text-sm" value={to} onChange={(e) => setTo(e.target.value)}>
        <option value="">to…</option>
        {memberIds.map((id) => <option key={id} value={id}>{label(id)}</option>)}
      </select>
      <select className="h-8 rounded-md border bg-background px-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as LinkRole)}>
        {LINK_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <select className="h-8 rounded-md border bg-background px-2 text-sm" value={protocol} onChange={(e) => setProtocol(e.target.value as LinkProtocol | "")}>
        <option value="">(no protocol)</option>
        {LINK_PROTOCOLS.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <select className="h-8 rounded-md border bg-background px-2 text-sm" value={fstatus} onChange={(e) => setFstatus(e.target.value as "existing" | "proposed")}>
        <option value="proposed">proposed</option>
        <option value="existing">existing</option>
      </select>
      <Button type="button" size="sm" variant="outline" disabled={!from || !to || from === to}
        onClick={() => { onAdd({ from, to, role, protocol: protocol || undefined, status: fstatus }); setFrom(""); setTo("") }}>
        Add
      </Button>
    </div>
  )
}
