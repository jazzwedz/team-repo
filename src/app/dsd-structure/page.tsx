"use client"

// DSD Output structure editor.
//
// The counterpart to the Agents page: agents are HOW each section is
// written; this defines WHAT chapters the DSD has — their titles, the
// guidance (what each must contain), which writer owns them, and the
// critics' focus. Saved to dsd-structure.yaml in the data repo and read by
// the generator. The five writer agents and four critics are fixed (they
// map to trainable personas); everything else here is editable. Generation
// is otherwise unchanged — this only fine-tunes the output definition.

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ListTree,
  Loader2,
  AlertCircle,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Save,
  RotateCcw,
  Info,
} from "lucide-react"

interface Chapter {
  id: string
  title: string
  guidance: string
}
interface Group {
  agentId: string
  name: string
  focus: string
  chapters: Chapter[]
}
interface Critic {
  agentId: string
  name: string
  focus: string
}
interface Structure {
  groups: Group[]
  critics: Critic[]
}

export default function DsdStructurePage() {
  const [structure, setStructure] = useState<Structure | null>(null)
  const [sha, setSha] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const newIdCounter = useRef(0)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch("/api/dsd-structure")
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || `Failed (${r.status})`)
      setStructure(d.structure)
      setSha(d.sha)
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function edit(mutator: (s: Structure) => Structure) {
    setStructure((prev) => (prev ? mutator(structuredClone(prev)) : prev))
    setDirty(true)
    setSavedMsg(null)
  }

  const setGroup = (gi: number, patch: Partial<Group>) =>
    edit((s) => {
      s.groups[gi] = { ...s.groups[gi], ...patch }
      return s
    })
  const setChapter = (gi: number, ci: number, patch: Partial<Chapter>) =>
    edit((s) => {
      s.groups[gi].chapters[ci] = { ...s.groups[gi].chapters[ci], ...patch }
      return s
    })
  const deleteChapter = (gi: number, ci: number) =>
    edit((s) => {
      s.groups[gi].chapters.splice(ci, 1)
      return s
    })
  const moveChapter = (gi: number, ci: number, dir: -1 | 1) =>
    edit((s) => {
      const arr = s.groups[gi].chapters
      const j = ci + dir
      if (j < 0 || j >= arr.length) return s
      ;[arr[ci], arr[j]] = [arr[j], arr[ci]]
      return s
    })
  const moveToGroup = (gi: number, ci: number, targetGi: number) =>
    edit((s) => {
      if (targetGi === gi) return s
      const [ch] = s.groups[gi].chapters.splice(ci, 1)
      s.groups[targetGi].chapters.push(ch)
      return s
    })
  const addChapter = (gi: number) =>
    edit((s) => {
      newIdCounter.current += 1
      const id = `custom-${Date.now().toString(36)}-${newIdCounter.current}`
      s.groups[gi].chapters.push({ id, title: "New chapter", guidance: "" })
      return s
    })
  const setCritic = (ci: number, patch: Partial<Critic>) =>
    edit((s) => {
      s.critics[ci] = { ...s.critics[ci], ...patch }
      return s
    })

  async function save() {
    if (!structure) return
    setSaving(true)
    setError(null)
    try {
      const r = await fetch("/api/dsd-structure", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ structure, sha }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || `Save failed (${r.status})`)
      setStructure(d.structure)
      setSha(d.sha)
      setDirty(false)
      setSavedMsg("Saved — applies to the next DSD generation.")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  async function resetDefaults() {
    if (!confirm("Reset the DSD output structure to the built-in default? Your customisations will be removed.")) return
    setResetting(true)
    setError(null)
    try {
      const r = await fetch("/api/dsd-structure/reset", { method: "POST" })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || `Reset failed (${r.status})`)
      setStructure(d.structure)
      setSha(d.sha)
      setDirty(false)
      setSavedMsg("Reset to defaults.")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed")
    } finally {
      setResetting(false)
    }
  }

  const totalChapters = structure?.groups.reduce((n, g) => n + g.chapters.length, 0) ?? 0

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ListTree className="h-7 w-7" />
            DSD Output Structure
          </h1>
          <p className="text-muted-foreground mt-1">
            {loading ? "Loading…" : `${totalChapters} chapters across ${structure?.groups.length ?? 0} writers — what the generated DSD must contain.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={resetDefaults} disabled={resetting || saving || loading}>
            {resetting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1.5" />}
            Reset to default
          </Button>
          <Button onClick={save} disabled={!dirty || saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
            Save
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 flex items-start gap-2">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          Edit each chapter&apos;s <strong>title</strong> and <strong>guidance</strong> (what the writer must produce), reorder or delete
          chapters, or move a chapter to a different writer. The DSD is generated exactly as before — this only fine-tunes the output
          definition. <strong>Document History</strong> (chapter 1) is always added automatically. Changes apply to the next generation.
        </span>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}
      {savedMsg && !dirty && (
        <div className="rounded-md border border-green-300 bg-green-50 p-2.5 text-sm text-green-900">{savedMsg}</div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading structure…
        </div>
      )}

      {!loading && structure && (
        <div className="space-y-5">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Writers &amp; chapters</h2>
          {structure.groups.map((g, gi) => (
            <Card key={g.agentId}>
              <CardHeader className="pb-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-base">{g.name}</CardTitle>
                    <code className="text-[10px] text-muted-foreground">{g.agentId}</code>
                    <span className="ml-auto text-xs text-muted-foreground">{g.chapters.length} chapter{g.chapters.length === 1 ? "" : "s"}</span>
                  </div>
                  <Input
                    value={g.focus}
                    onChange={(e) => setGroup(gi, { focus: e.target.value })}
                    placeholder="One-line focus of this writer"
                    className="text-xs"
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {g.chapters.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No chapters — this writer is skipped.</p>
                )}
                {g.chapters.map((c, ci) => (
                  <div key={c.id} className="rounded-md border p-3 space-y-2 bg-muted/10">
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={c.title}
                        onChange={(e) => setChapter(gi, ci, { title: e.target.value })}
                        placeholder="Chapter title (e.g. 5. Solution Architecture)"
                        className="font-medium"
                      />
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={ci === 0} onClick={() => moveChapter(gi, ci, -1)} title="Move up">
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={ci === g.chapters.length - 1} onClick={() => moveChapter(gi, ci, 1)} title="Move down">
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-red-600" onClick={() => deleteChapter(gi, ci)} title="Delete chapter">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Textarea
                      value={c.guidance}
                      onChange={(e) => setChapter(gi, ci, { guidance: e.target.value })}
                      placeholder="Guidance — what this chapter must contain (grounded in the verified facts)."
                      rows={3}
                      className="text-xs"
                    />
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Move to writer:</span>
                      <select
                        className="h-7 rounded-md border bg-background px-2 text-xs"
                        value={gi}
                        onChange={(e) => moveToGroup(gi, ci, Number(e.target.value))}
                      >
                        {structure.groups.map((tg, tgi) => (
                          <option key={tg.agentId} value={tgi}>
                            {tg.name}
                          </option>
                        ))}
                      </select>
                      <code className="ml-auto text-[10px] opacity-60">{c.id}</code>
                    </div>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => addChapter(gi)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add chapter
                </Button>
              </CardContent>
            </Card>
          ))}

          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide pt-2">Critic lenses</h2>
          <Card>
            <CardContent className="pt-4 space-y-3">
              {structure.critics.map((c, ci) => (
                <div key={c.agentId} className="rounded-md border p-3 space-y-1.5 bg-muted/10">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{c.name}</span>
                    <code className="text-[10px] text-muted-foreground">{c.agentId}</code>
                  </div>
                  <Textarea
                    value={c.focus}
                    onChange={(e) => setCritic(ci, { focus: e.target.value })}
                    placeholder="What this critic looks for"
                    rows={2}
                    className="text-xs"
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex justify-end pt-2">
            <Button onClick={save} disabled={!dirty || saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
              Save changes
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
