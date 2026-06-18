"use client"

// Operational logs browser — filterable table of base log entries
// (debug / info / warn / error). The list endpoint returns newest-
// first within the chosen date file.

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

interface LogRow {
  ts: string
  level: "debug" | "info" | "warn" | "error"
  msg: string
  requestId?: string
  user?: string
  route?: string
  source?: "server" | "client"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta?: Record<string, any>
}

interface ListResponse {
  dates: string[]
  entries: LogRow[]
  date?: string
  note?: string
}

export default function LogsPage() {
  const [dates, setDates] = useState<string[]>([])
  const [date, setDate] = useState<string>("")
  const [note, setNote] = useState<string | null>(null)
  const [entries, setEntries] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(false)
  const [level, setLevel] = useState<"all" | "debug" | "info" | "warn" | "error">("all")
  const [filterUser, setFilterUser] = useState("")
  const [filterRoute, setFilterRoute] = useState("")
  const [filterQ, setFilterQ] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set("stream", "app")
    if (date) params.set("date", date)
    if (level !== "all") params.set("level", level)
    if (filterUser) params.set("user", filterUser)
    if (filterRoute) params.set("route", filterRoute)
    if (filterQ) params.set("q", filterQ)
    try {
      const res = await fetch(`/api/admin/logs?${params.toString()}`)
      const data = (await res.json()) as ListResponse
      setDates(data.dates || [])
      setEntries(data.entries || [])
      setNote(data.note || null)
      if (!date && data.date) setDate(data.date)
    } finally {
      setLoading(false)
    }
  }, [date, level, filterUser, filterRoute, filterQ])

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
          <label className="block text-xs text-muted-foreground mb-1">Level</label>
          <Select value={level} onValueChange={(v) => setLevel(v as "all" | "debug" | "info" | "warn" | "error")}>
            <SelectTrigger className="w-[120px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="debug">Debug</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warn">Warn</SelectItem>
              <SelectItem value="error">Error</SelectItem>
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
            placeholder="/api/..."
            className="h-9 w-[200px]"
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
              <th className="text-left p-2 w-[60px]">Level</th>
              <th className="text-left p-2 w-[80px]">Source</th>
              <th className="text-left p-2 w-[140px]">User</th>
              <th className="text-left p-2 w-[200px]">Route</th>
              <th className="text-left p-2">Message</th>
            </tr>
          </thead>
          <tbody>
            {loading && entries.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Loading...
                </td>
              </tr>
            )}
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  No log entries match the current filters.
                </td>
              </tr>
            )}
            {entries.map((e, i) => (
              <LogRowComponent key={i} e={e} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LogRowComponent({ e }: { e: LogRow }) {
  const [expanded, setExpanded] = useState(false)
  const levelClass =
    e.level === "error"
      ? "text-destructive font-semibold"
      : e.level === "warn"
      ? "text-orange-700 font-semibold"
      : "text-muted-foreground"
  return (
    <>
      <tr
        className="border-t hover:bg-muted/30 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="p-2 font-mono text-[11px]">{e.ts.slice(11, 19)}</td>
        <td className={`p-2 ${levelClass} uppercase text-[10px]`}>{e.level}</td>
        <td className="p-2 text-[10px]">{e.source || "server"}</td>
        <td className="p-2 font-mono text-[11px]">{e.user || "—"}</td>
        <td className="p-2 font-mono text-[11px]">{e.route || "—"}</td>
        <td className="p-2">{e.msg}</td>
      </tr>
      {expanded && e.meta && Object.keys(e.meta).length > 0 && (
        <tr className="bg-muted/20 border-t">
          <td colSpan={6} className="p-2">
            <pre className="text-[10px] font-mono whitespace-pre-wrap break-all">
              {JSON.stringify(e.meta, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}
