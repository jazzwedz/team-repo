"use client"

// Admin audit log browser — admin_action entries (init-storage runs,
// settings saves, lock acquire / release / denied, llm export, ...).

import { useCallback, useEffect, useState } from "react"
import { Loader2, RefreshCw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface AuditRow {
  ts: string
  user?: string
  action: string
  requestId?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta?: Record<string, any>
}

interface ListResponse {
  dates: string[]
  entries: AuditRow[]
  date?: string
  note?: string
}

export default function AuditPage() {
  const [dates, setDates] = useState<string[]>([])
  const [date, setDate] = useState<string>("")
  const [note, setNote] = useState<string | null>(null)
  const [entries, setEntries] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(false)
  const [filterUser, setFilterUser] = useState("")
  const [filterAction, setFilterAction] = useState("")
  const [filterQ, setFilterQ] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (date) params.set("date", date)
    if (filterUser) params.set("user", filterUser)
    if (filterAction) params.set("action", filterAction)
    if (filterQ) params.set("q", filterQ)
    try {
      const res = await fetch(`/api/admin/audit?${params.toString()}`)
      const data = (await res.json()) as ListResponse
      setDates(data.dates || [])
      setEntries(data.entries || [])
      setNote(data.note || null)
      if (!date && data.date) setDate(data.date)
    } finally {
      setLoading(false)
    }
  }, [date, filterUser, filterAction, filterQ])

  useEffect(() => {
    load()
  }, [load])

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
          <label className="block text-xs text-muted-foreground mb-1">Action</label>
          <Input
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            placeholder="lock.acquire"
            className="h-9 w-[180px]"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-muted-foreground mb-1">
            <Search className="h-3 w-3 inline mr-1" />Search
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

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="text-left p-2 w-[110px]">Time</th>
              <th className="text-left p-2 w-[160px]">User</th>
              <th className="text-left p-2 w-[200px]">Action</th>
              <th className="text-left p-2">Detail</th>
            </tr>
          </thead>
          <tbody>
            {loading && entries.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Loading...
                </td>
              </tr>
            )}
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-muted-foreground">
                  No admin actions recorded yet.
                </td>
              </tr>
            )}
            {entries.map((e, i) => (
              <AuditRowComponent key={i} e={e} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AuditRowComponent({ e }: { e: AuditRow }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      <tr
        className="border-t hover:bg-muted/30 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="p-2 font-mono text-[11px]">{e.ts.slice(11, 19)}</td>
        <td className="p-2 font-mono text-[11px]">{e.user || "—"}</td>
        <td className="p-2 font-mono">{e.action}</td>
        <td className="p-2 text-[11px] text-muted-foreground truncate max-w-[420px]">
          {e.meta ? JSON.stringify(e.meta) : "—"}
        </td>
      </tr>
      {expanded && e.meta && (
        <tr className="bg-muted/20 border-t">
          <td colSpan={4} className="p-2">
            <pre className="text-[10px] font-mono whitespace-pre-wrap break-all">
              {JSON.stringify(e.meta, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}
