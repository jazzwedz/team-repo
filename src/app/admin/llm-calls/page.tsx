"use client"

// LLM calls browser — the primary admin tool. Shows recent calls with
// summary metadata; clicking a row expands the full prompt + response
// side-by-side so an analyst can read what GPT/Claude was asked and
// what it answered. Selected rows export to OpenAI fine-tuning JSONL
// format with a single button.

import { useCallback, useEffect, useState } from "react"
import { Loader2, Download, RefreshCw, Search, Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface LLMRow {
  ts: string
  requestId?: string
  user?: string
  route?: string
  provider: string
  model: string
  promptChars: number
  responseChars: number
  latencyMs: number
  ok: boolean
  error?: string
  _index: number
  _previewPrompt?: string
  _previewResponse?: string
}

interface ListResponse {
  dates: string[]
  entries: LLMRow[]
  date?: string
  note?: string
}

interface FullEntry extends LLMRow {
  prompt?: string
  response?: string
}

export default function LLMCallsPage() {
  const [dates, setDates] = useState<string[]>([])
  const [date, setDate] = useState<string>("")
  const [note, setNote] = useState<string | null>(null)
  const [entries, setEntries] = useState<LLMRow[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Record<number, boolean>>({})
  const [expanded, setExpanded] = useState<number | null>(null)
  const [detail, setDetail] = useState<FullEntry | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  // Filters
  const [filterUser, setFilterUser] = useState("")
  const [filterRoute, setFilterRoute] = useState("")
  const [filterOk, setFilterOk] = useState<"all" | "true" | "false">("all")
  const [filterQ, setFilterQ] = useState("")
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (date) params.set("date", date)
    if (filterUser) params.set("user", filterUser)
    if (filterRoute) params.set("route", filterRoute)
    if (filterOk !== "all") params.set("ok", filterOk)
    if (filterQ) params.set("q", filterQ)
    try {
      const res = await fetch(`/api/admin/llm-calls?${params.toString()}`)
      const data = (await res.json()) as ListResponse
      setDates(data.dates || [])
      setEntries(data.entries || [])
      setNote(data.note || null)
      if (!date && data.date) setDate(data.date)
    } finally {
      setLoading(false)
    }
  }, [date, filterUser, filterRoute, filterOk, filterQ])

  useEffect(() => {
    load()
  }, [load])

  async function openDetail(idx: number) {
    if (expanded === idx) {
      setExpanded(null)
      setDetail(null)
      return
    }
    setExpanded(idx)
    setDetail(null)
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/admin/llm-calls/${idx}?date=${encodeURIComponent(date)}`)
      if (res.ok) {
        setDetail((await res.json()) as FullEntry)
      }
    } finally {
      setDetailLoading(false)
    }
  }

  function toggleSelect(idx: number) {
    setSelected((p) => ({ ...p, [idx]: !p[idx] }))
  }

  function setAllSelected(value: boolean) {
    const next: Record<number, boolean> = {}
    if (value) for (const e of entries) next[e._index] = true
    setSelected(next)
  }

  async function exportSelected(format: "fine-tune" | "raw") {
    const indices = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => Number(k))
    if (indices.length === 0) return
    setExporting(true)
    try {
      const res = await fetch("/api/admin/llm-calls/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, indices, format }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(body.error || `Export failed: ${res.status}`)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `llm-calls-${date}.jsonl`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const selectedCount = Object.values(selected).filter(Boolean).length

  return (
    <div className="space-y-4">
      {note && (
        <div className="rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
          {note}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Date</label>
          <Select value={date} onValueChange={(v) => setDate(v)}>
            <SelectTrigger className="w-[160px] h-9">
              <SelectValue placeholder="Pick a date" />
            </SelectTrigger>
            <SelectContent>
              {dates.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">User</label>
          <Input
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            placeholder="alice"
            className="h-9 w-[140px]"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Route</label>
          <Input
            value={filterRoute}
            onChange={(e) => setFilterRoute(e.target.value)}
            placeholder="/api/generate"
            className="h-9 w-[220px]"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Result</label>
          <Select value={filterOk} onValueChange={(v) => setFilterOk(v as "all" | "true" | "false")}>
            <SelectTrigger className="w-[120px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="true">OK only</SelectItem>
              <SelectItem value="false">Failed only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-muted-foreground mb-1">
            <Search className="h-3 w-3 inline mr-1" />Search prompt/response
          </label>
          <Input
            value={filterQ}
            onChange={(e) => setFilterQ(e.target.value)}
            placeholder="full-text"
            className="h-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {entries.length > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <span>{entries.length} calls · {selectedCount} selected</span>
          <button
            type="button"
            onClick={() => setAllSelected(true)}
            className="underline"
          >
            Select all
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={() => setAllSelected(false)}
            className="underline"
          >
            Clear
          </button>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => exportSelected("fine-tune")}
              disabled={exporting || selectedCount === 0}
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              Export as fine-tune JSONL
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => exportSelected("raw")}
              disabled={exporting || selectedCount === 0}
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              Raw JSONL
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="p-2 w-8"></th>
              <th className="text-left p-2 w-[140px]">Time</th>
              <th className="text-left p-2">Route</th>
              <th className="text-left p-2">User</th>
              <th className="text-left p-2">Model</th>
              <th className="text-right p-2">Prompt</th>
              <th className="text-right p-2">Response</th>
              <th className="text-right p-2">Latency</th>
              <th className="text-center p-2 w-12">OK</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && !loading && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-muted-foreground">
                  No LLM calls in this view.
                </td>
              </tr>
            )}
            {entries.map((e) => {
              const open = expanded === e._index
              return (
                <FragmentRow
                  key={e._index}
                  e={e}
                  open={open}
                  detail={detail}
                  detailLoading={detailLoading}
                  selected={!!selected[e._index]}
                  onToggleSelect={() => toggleSelect(e._index)}
                  onClickRow={() => openDetail(e._index)}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FragmentRow({
  e,
  open,
  detail,
  detailLoading,
  selected,
  onToggleSelect,
  onClickRow,
}: {
  e: LLMRow
  open: boolean
  detail: FullEntry | null
  detailLoading: boolean
  selected: boolean
  onToggleSelect: () => void
  onClickRow: () => void
}) {
  return (
    <>
      <tr
        className={`border-t cursor-pointer hover:bg-muted/30 ${open ? "bg-muted/40" : ""}`}
        onClick={onClickRow}
      >
        <td className="p-2 text-center" onClick={(ev) => ev.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="h-3.5 w-3.5"
            aria-label="Select call"
          />
        </td>
        <td className="p-2 font-mono">{e.ts.slice(11, 19)}</td>
        <td className="p-2 font-mono text-[11px]">{e.route || "—"}</td>
        <td className="p-2 font-mono text-[11px]">{e.user || "—"}</td>
        <td className="p-2 font-mono text-[11px]">{e.provider} · {e.model}</td>
        <td className="p-2 text-right">{e.promptChars.toLocaleString()}</td>
        <td className="p-2 text-right">{e.responseChars.toLocaleString()}</td>
        <td className="p-2 text-right">{e.latencyMs}ms</td>
        <td className="p-2 text-center">
          {e.ok ? (
            <Check className="h-3.5 w-3.5 inline text-green-700" />
          ) : (
            <X className="h-3.5 w-3.5 inline text-destructive" />
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/20 border-t">
          <td colSpan={9} className="p-3">
            {detailLoading ? (
              <div className="text-center py-6 text-muted-foreground text-xs">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                Loading...
              </div>
            ) : detail ? (
              <DetailPanel call={detail} />
            ) : null}
          </td>
        </tr>
      )}
    </>
  )
}

function DetailPanel({ call }: { call: FullEntry }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-muted-foreground">
        <div><strong>Request ID:</strong> <code className="font-mono">{call.requestId}</code></div>
        <div><strong>Timestamp:</strong> <code className="font-mono">{call.ts}</code></div>
      </div>
      {call.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          <strong>Error:</strong> {call.error}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-md border bg-background">
          <div className="border-b px-2 py-1.5 flex items-center justify-between bg-muted/40">
            <span className="text-xs font-semibold">Prompt ({call.promptChars.toLocaleString()} chars)</span>
            {call.prompt && (
              <button
                type="button"
                className="text-[10px] underline"
                onClick={() => navigator.clipboard.writeText(call.prompt || "")}
              >
                Copy
              </button>
            )}
          </div>
          <pre className="whitespace-pre-wrap break-all p-2 text-[11px] font-mono max-h-[420px] overflow-auto">
            {call.prompt || "(not captured — LLM_LOG_FULL is summary)"}
          </pre>
        </div>
        <div className="rounded-md border bg-background">
          <div className="border-b px-2 py-1.5 flex items-center justify-between bg-muted/40">
            <span className="text-xs font-semibold">Response ({call.responseChars.toLocaleString()} chars)</span>
            {call.response && (
              <button
                type="button"
                className="text-[10px] underline"
                onClick={() => navigator.clipboard.writeText(call.response || "")}
              >
                Copy
              </button>
            )}
          </div>
          <pre className="whitespace-pre-wrap break-all p-2 text-[11px] font-mono max-h-[420px] overflow-auto">
            {call.response || "(not captured)"}
          </pre>
        </div>
      </div>
    </div>
  )
}
