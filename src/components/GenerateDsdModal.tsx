"use client"

// Pre-generation setup for a DSD: mode, reuse-locked, bring-your-own
// (per-chapter locked content), depth, audience, and an Advanced section
// (chapters to include + language). Collects everything and hands it to the
// parent's generate call.

import { useEffect, useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Sparkles, FileText, Paperclip, Loader2, X, FileCode2 } from "lucide-react"
import { ALL_CHAPTERS } from "@/lib/dsd-sections"

export interface DsdGenerateOptions {
  mode: "quick" | "team"
  provided: Record<string, string>
  depth: "concise" | "standard" | "detailed"
  audience: "technical" | "management" | "mixed"
  language: "en" | "sk"
  includeChapters: string[]
}

interface SourceDocMeta {
  id: string
  name: string
  createdAt: string
  chars: number
}

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { v: T; label: string; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1 rounded-md border p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          title={o.title}
          onClick={() => onChange(o.v)}
          className={`px-2.5 py-1 rounded text-xs font-medium ${value === o.v ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function GenerateDsdModal({
  open,
  onOpenChange,
  solutionId,
  hasPreviousLocked,
  latestLocked,
  onGenerate,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** Solution id — used to store/reuse source requirement documents. */
  solutionId: string
  hasPreviousLocked: boolean
  /** Locked chapters parsed from the most recent DSD (chapter id → text). */
  latestLocked: Record<string, string>
  onGenerate: (opts: DsdGenerateOptions) => void
}) {
  const [mode, setMode] = useState<"quick" | "team">("team")
  const [useLast, setUseLast] = useState(true)
  const [edits, setEdits] = useState<Record<string, string>>({})
  // Depth + audience are fixed (detailed / mixed) — the toggles were removed
  // from the UI; the values are still passed through to the generator.
  const [language, setLanguage] = useState<"en" | "sk">("en")
  // Whether the source-code repo (SRC_ADO_*) is connected — drives the
  // "source code will be used" note.
  const [sourceConfigured, setSourceConfigured] = useState(false)
  useEffect(() => {
    fetch("/api/source-code/status")
      .then((r) => r.json())
      .then((d) => setSourceConfigured(!!d.configured))
      .catch(() => setSourceConfigured(false))
  }, [])
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [showProvide, setShowProvide] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Source requirements documents (BRD/spec) — stored ON the solution and
  // reused across the composer and every DSD run (upload once).
  const [showSource, setShowSource] = useState(false)
  const [docs, setDocs] = useState<SourceDocMeta[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [srcUrl, setSrcUrl] = useState("")
  const [pasteVal, setPasteVal] = useState("")
  const [srcBusy, setSrcBusy] = useState(false)
  const [srcErr, setSrcErr] = useState<string | null>(null)

  // Load the solution's stored docs whenever the modal opens.
  useEffect(() => {
    if (!open || !solutionId) return
    setDocsLoading(true)
    fetch(`/api/solutions/${encodeURIComponent(solutionId)}/source-docs`)
      .then((r) => r.json())
      .then((d) => setDocs(Array.isArray(d) ? d : []))
      .catch(() => setDocs([]))
      .finally(() => setDocsLoading(false))
  }, [open, solutionId])

  async function refreshDocs() {
    try {
      const r = await fetch(`/api/solutions/${encodeURIComponent(solutionId)}/source-docs`)
      const d = await r.json()
      setDocs(Array.isArray(d) ? d : [])
    } catch {
      /* keep current */
    }
  }

  // Save extracted text as a stored doc on the solution.
  async function storeDoc(name: string, text: string) {
    const r = await fetch(`/api/solutions/${encodeURIComponent(solutionId)}/source-docs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, text }),
    })
    const d = await r.json().catch(() => null)
    if (!r.ok) throw new Error((d && d.error) || `Save failed (${r.status})`)
    await refreshDocs()
  }

  async function addFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSrcBusy(true)
    setSrcErr(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const r = await fetch("/api/extract-doc", { method: "POST", body: fd })
      const d = await r.json().catch(() => null)
      if (!r.ok || !d?.text) throw new Error((d && d.error) || "Could not read the file.")
      await storeDoc(d.name || file.name, d.text)
    } catch (err) {
      setSrcErr(err instanceof Error ? err.message : "Could not read the file.")
    } finally {
      setSrcBusy(false)
      e.target.value = ""
    }
  }

  async function addUrl() {
    if (!srcUrl.trim()) return
    setSrcBusy(true)
    setSrcErr(null)
    try {
      const r = await fetch("/api/extract-doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: { type: "confluence", url: srcUrl.trim() } }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok || !d?.text) throw new Error((d && d.error) || "Could not fetch that page.")
      await storeDoc(d.name || "confluence page", d.text)
      setSrcUrl("")
    } catch (err) {
      setSrcErr(err instanceof Error ? err.message : "Could not fetch that page.")
    } finally {
      setSrcBusy(false)
    }
  }

  async function addPasted() {
    if (!pasteVal.trim()) return
    setSrcBusy(true)
    setSrcErr(null)
    try {
      await storeDoc("pasted text", pasteVal)
      setPasteVal("")
    } catch (err) {
      setSrcErr(err instanceof Error ? err.message : "Could not save.")
    } finally {
      setSrcBusy(false)
    }
  }

  async function removeDoc(docId: string) {
    setSrcErr(null)
    try {
      await fetch(`/api/solutions/${encodeURIComponent(solutionId)}/source-docs/${encodeURIComponent(docId)}`, {
        method: "DELETE",
      })
      await refreshDocs()
    } catch {
      setSrcErr("Could not remove the document.")
    }
  }

  // Effective provided text per chapter: manual edit wins, else the
  // reused-from-last value when that toggle is on.
  const valueFor = (id: string) =>
    edits[id] !== undefined ? edits[id] : useLast && hasPreviousLocked ? latestLocked[id] || "" : ""

  const lockedCount = useMemo(
    () => ALL_CHAPTERS.filter((c) => valueFor(c.id).trim() && !excluded.has(c.id)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edits, useLast, excluded, latestLocked]
  )

  const start = () => {
    const provided: Record<string, string> = {}
    for (const c of ALL_CHAPTERS) {
      if (excluded.has(c.id)) continue
      const v = valueFor(c.id).trim()
      if (v) provided[c.id] = v
    }
    const includeChapters = ALL_CHAPTERS.filter((c) => !excluded.has(c.id)).map((c) => c.id)
    onGenerate({ mode, provided, depth: "detailed", audience: "mixed", language, includeChapters })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl top-12 translate-y-0 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Generate DSD
          </DialogTitle>
          <DialogDescription>Set up how the document is produced, then generate.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* mode */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-medium">Mode</div>
              <div className="text-xs text-muted-foreground">Agent team is the configurable, trainable pipeline.</div>
            </div>
            <Seg
              value={mode}
              onChange={setMode}
              options={[
                { v: "quick", label: "Quick", title: "Fast single draft → critic → revise" },
                { v: "team", label: "Agent team", title: "Section writers + critic panel + lead" },
              ]}
            />
          </div>

          {mode === "team" && (
            <>
              {/* Source-code grounding note — shown only when the source repo
                  is connected. DSD generation reads the files mapped on each
                  member (source.paths) as authoritative grounding. */}
              {sourceConfigured && (
                <div className="rounded-md border bg-muted/20 p-3 text-sm flex items-start gap-2">
                  <FileCode2 className="h-4 w-4 mt-0.5 shrink-0 text-blue-600" />
                  <span>
                    <span className="font-medium">Source code will be used.</span>{" "}
                    <span className="text-muted-foreground">
                      The connected repository is read (read-only) for any member
                      mapped to it (<code>source.paths</code>) and used as
                      grounding for the requirements, data structures and
                      interactions.
                    </span>
                  </span>
                </div>
              )}

              {/* reuse locked */}
              {hasPreviousLocked && (
                <label className="flex items-center gap-2 rounded-md border bg-muted/20 p-3 text-sm cursor-pointer">
                  <input type="checkbox" className="h-4 w-4" checked={useLast} onChange={(e) => setUseLast(e.target.checked)} />
                  <span>
                    Reuse locked content from the last DSD
                    <span className="text-muted-foreground"> — keeps your previously fixed chapters word-for-word.</span>
                  </span>
                </label>
              )}

              {/* source requirements (BRD) grounding */}
              <div className="rounded-md border bg-muted/20">
                <button type="button" onClick={() => setShowSource((v) => !v)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="font-medium">
                    Source requirements (BRD / spec) <span className="font-normal text-muted-foreground">(optional)</span>
                    {docs.length > 0 && (
                      <Badge variant="outline" className="ml-2 text-[10px] text-green-700 border-green-300">{docs.length} stored</Badge>
                    )}
                  </span>
                  <span className="text-muted-foreground">{showSource ? "▲" : "▼"}</span>
                </button>
                {showSource && (
                  <div className="border-t p-3 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Documents stored on this solution. Upload once — the team grounds the <span className="font-medium">Document Purpose</span>, <span className="font-medium">Functional Requirements</span> and <span className="font-medium">Traceability</span> on them every time, and the composer reuses them too.
                    </p>

                    {docsLoading ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                      </div>
                    ) : docs.length > 0 ? (
                      <div className="space-y-1">
                        {docs.map((d) => (
                          <div key={d.id} className="flex items-center gap-2 rounded-md border border-green-300 bg-green-50/50 p-2 text-xs">
                            <FileText className="h-4 w-4 shrink-0 text-green-700" />
                            <span className="font-medium truncate">{d.name}</span>
                            <span className="text-muted-foreground whitespace-nowrap">· {d.chars.toLocaleString()} chars</span>
                            <button type="button" onClick={() => removeDoc(d.id)} className="ml-auto text-muted-foreground hover:text-destructive" title="Remove from solution">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No documents stored yet.</p>
                    )}

                    <div className="space-y-2 pt-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <label className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs cursor-pointer hover:bg-muted">
                          {srcBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                          Add PDF / text
                          <input type="file" accept=".pdf,.txt,.md,.markdown,.text" className="hidden" onChange={addFile} disabled={srcBusy} />
                        </label>
                        <span className="text-xs text-muted-foreground">or</span>
                        <input
                          value={srcUrl}
                          onChange={(e) => setSrcUrl(e.target.value)}
                          placeholder="Confluence page URL / id"
                          className="flex-1 min-w-[140px] rounded-md border px-2 py-1 text-xs bg-white"
                        />
                        <Button type="button" variant="outline" size="sm" onClick={addUrl} disabled={srcBusy || !srcUrl.trim()}>
                          Add
                        </Button>
                      </div>
                      <Textarea
                        value={pasteVal}
                        onChange={(e) => setPasteVal(e.target.value)}
                        rows={2}
                        placeholder="…or paste requirements text to add"
                        className="text-xs bg-white"
                      />
                      {pasteVal.trim() && (
                        <Button type="button" variant="outline" size="sm" onClick={addPasted} disabled={srcBusy}>
                          Add pasted text
                        </Button>
                      )}
                    </div>
                    {srcErr && <p className="text-xs text-destructive">{srcErr}</p>}
                  </div>
                )}
              </div>

              {/* bring your own */}
              <div className="rounded-md border bg-muted/20">
                <button type="button" onClick={() => setShowProvide((v) => !v)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="font-medium">
                    Bring your own content <span className="font-normal text-muted-foreground">(optional)</span>
                    {lockedCount > 0 && (
                      <Badge variant="outline" className="ml-2 text-[10px] text-amber-700 border-amber-300">{lockedCount} locked</Badge>
                    )}
                  </span>
                  <span className="text-muted-foreground">{showProvide ? "▲" : "▼"}</span>
                </button>
                {showProvide && (
                  <div className="border-t p-3 space-y-2 max-h-[18rem] overflow-y-auto">
                    <p className="text-xs text-muted-foreground">
                      Paste any chapter you already have — the team keeps it <span className="font-medium">word-for-word (🔒)</span> and writes the rest around it.
                    </p>
                    {ALL_CHAPTERS.filter((c) => !excluded.has(c.id)).map((c) => {
                      const v = valueFor(c.id)
                      const locked = !!v.trim()
                      return (
                        <div key={c.id} className={`rounded-md border p-2 ${locked ? "border-amber-300 bg-amber-50/40" : ""}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium">{c.title}</span>
                            {locked && <Badge variant="outline" className="ml-auto text-[10px] text-amber-700 border-amber-300">🔒 kept as-is</Badge>}
                          </div>
                          <Textarea
                            value={v}
                            onChange={(e) => setEdits((p) => ({ ...p, [c.id]: e.target.value }))}
                            rows={2}
                            placeholder="Paste your version to lock it…"
                            className="text-xs bg-white"
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* advanced */}
              <div className="rounded-md border">
                <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="font-medium">Advanced</span>
                  <span className="text-muted-foreground">{showAdvanced ? "▲" : "▼"}</span>
                </button>
                {showAdvanced && (
                  <div className="border-t p-3 space-y-3">
                    <div>
                      <div className="text-sm font-medium mb-1">Chapters to include</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {ALL_CHAPTERS.map((c) => (
                          <label key={c.id} className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5"
                              checked={!excluded.has(c.id)}
                              onChange={(e) =>
                                setExcluded((s) => {
                                  const n = new Set(s)
                                  if (e.target.checked) n.delete(c.id)
                                  else n.add(c.id)
                                  return n
                                })
                              }
                            />
                            {c.title}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Language</span>
                      <Seg
                        value={language}
                        onChange={setLanguage}
                        options={[
                          { v: "en", label: "English" },
                          { v: "sk", label: "Slovak" },
                        ]}
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="flex justify-between pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={start}>
              <Sparkles className="h-4 w-4 mr-1.5" />
              Generate
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
