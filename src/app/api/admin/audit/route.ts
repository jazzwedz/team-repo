// GET /api/admin/audit?date=YYYY-MM-DD&action=...&user=...&q=...&limit=...
//
// Returns admin_action entries (init-storage runs, settings saves,
// lock takeovers, llm exports, ...).

import { NextResponse } from "next/server"
import { getLogRoot, isAdminAction, listLogDates, readLogFile } from "@/lib/log/reader"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const root = getLogRoot()
  if (!root) {
    return NextResponse.json({
      dates: [],
      entries: [],
      note: "LOG_SINK is stdout-only — no on-disk audit log. Set LOG_SINK=file or LOG_SINK=both with LOG_PATH to enable.",
    })
  }
  const dates = await listLogDates("admin-actions")
  const dateParam = url.searchParams.get("date") || dates[0] || ""
  if (!dateParam) return NextResponse.json({ dates, entries: [] })

  const raw = await readLogFile("admin-actions", dateParam)
  const actions = raw.filter(isAdminAction)

  const action = url.searchParams.get("action")?.toLowerCase()
  const user = url.searchParams.get("user")?.toLowerCase()
  const q = url.searchParams.get("q")?.toLowerCase()
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "500", 10) || 500, 5000)

  const filtered = actions
    .filter((a) => {
      if (action && a.action.toLowerCase() !== action) return false
      if (user && (!a.user || !a.user.toLowerCase().includes(user))) return false
      if (q) {
        const blob = JSON.stringify(a).toLowerCase()
        if (!blob.includes(q)) return false
      }
      return true
    })
    .reverse()
    .slice(0, limit)

  return NextResponse.json({ dates, entries: filtered, date: dateParam })
}
