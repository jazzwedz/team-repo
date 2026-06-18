// GET /api/admin/logs?stream=app&date=2026-05-25
//   ?level=warn      filter
//   ?user=alice      filter
//   ?route=/api/...  filter (substring match)
//   ?q=foo           full-text in msg
//   ?limit=500       cap returned entries (newest first)
//
// All filters optional. When the file sink is off, returns
// { dates: [], entries: [], note: "LOG_SINK does not include file" }.

import { NextResponse } from "next/server"
import {
  getLogRoot,
  isAppEntry,
  listLogDates,
  readLogFile,
  type LogStream,
} from "@/lib/log/reader"

const VALID_STREAMS: LogStream[] = ["app", "llm", "admin-actions"]

export async function GET(request: Request) {
  const url = new URL(request.url)
  const streamRaw = (url.searchParams.get("stream") || "app").toLowerCase()
  const stream = (
    VALID_STREAMS.includes(streamRaw as LogStream) ? streamRaw : "app"
  ) as LogStream
  const root = getLogRoot()
  if (!root) {
    return NextResponse.json({
      dates: [],
      entries: [],
      stream,
      note: "LOG_SINK is stdout-only — no on-disk log archive to browse. Set LOG_SINK=file or LOG_SINK=both with LOG_PATH to enable.",
    })
  }
  const dates = await listLogDates(stream)
  const dateParam = url.searchParams.get("date") || dates[0] || ""
  if (!dateParam) {
    return NextResponse.json({ dates, entries: [], stream })
  }
  const entries = await readLogFile(stream, dateParam)
  // Filters
  const level = url.searchParams.get("level")
  const user = url.searchParams.get("user")
  const routeFilter = url.searchParams.get("route")
  const q = url.searchParams.get("q")?.toLowerCase()
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "500", 10) || 500, 5000)

  let filtered = entries.filter((e) => {
    if (level && isAppEntry(e) && e.level !== level) return false
    if (user) {
      const u = "user" in e ? e.user : undefined
      if (!u || !u.toLowerCase().includes(user.toLowerCase())) return false
    }
    if (routeFilter) {
      const r = "route" in e ? e.route : undefined
      if (!r || !r.toLowerCase().includes(routeFilter.toLowerCase())) return false
    }
    if (q) {
      const blob = JSON.stringify(e).toLowerCase()
      if (!blob.includes(q)) return false
    }
    return true
  })
  // Newest first (entries are append-only, oldest first on disk).
  filtered = filtered.reverse().slice(0, limit)
  return NextResponse.json({
    dates,
    entries: filtered,
    stream,
    date: dateParam,
  })
}
