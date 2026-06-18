// GET /api/admin/llm-calls?date=2026-05-25
//   ?user=alice
//   ?route=/api/components/foo/rules-import
//   ?ok=true|false
//   ?provider=anthropic|openai-compatible
//   ?q=foo                   full-text across prompt+response+route+user
//   ?limit=200
//
// Returns a summary view (no full prompt/response by default) so the
// list UI is snappy. Use /api/admin/llm-calls/[index] for the full
// entry.

import { NextResponse } from "next/server"
import { getLogRoot, isLLMCall, listLogDates, readLogFile } from "@/lib/log/reader"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const root = getLogRoot()
  if (!root) {
    return NextResponse.json({
      dates: [],
      entries: [],
      note: "LOG_SINK is stdout-only — no on-disk LLM call archive. Set LOG_SINK=file or LOG_SINK=both with LOG_PATH to enable.",
    })
  }
  const dates = await listLogDates("llm")
  const dateParam = url.searchParams.get("date") || dates[0] || ""
  if (!dateParam) return NextResponse.json({ dates, entries: [] })

  const raw = await readLogFile("llm", dateParam)
  const calls = raw.filter(isLLMCall)

  const user = url.searchParams.get("user")?.toLowerCase()
  const route = url.searchParams.get("route")?.toLowerCase()
  const provider = url.searchParams.get("provider")?.toLowerCase()
  const ok = url.searchParams.get("ok")
  const q = url.searchParams.get("q")?.toLowerCase()
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 2000)

  const include = url.searchParams.get("include") || "summary"
  const wantFull = include === "full"

  const filtered = calls.filter((c) => {
    if (user && (!c.user || !c.user.toLowerCase().includes(user))) return false
    if (route && (!c.route || !c.route.toLowerCase().includes(route))) return false
    if (provider && c.provider.toLowerCase() !== provider) return false
    if (ok === "true" && !c.ok) return false
    if (ok === "false" && c.ok) return false
    if (q) {
      const blob = JSON.stringify(c).toLowerCase()
      if (!blob.includes(q)) return false
    }
    return true
  })

  // Tag each with its position in the on-disk file so the detail
  // endpoint can fetch the same entry back.
  const indexed = filtered
    .map((entry, index) => ({ ...entry, _index: calls.indexOf(entry) }))
    // Newest first.
    .reverse()
    .slice(0, limit)
    .map((c) =>
      wantFull
        ? c
        : {
            ...c,
            prompt: undefined,
            response: undefined,
            _previewPrompt: c.prompt
              ? c.prompt.slice(0, 240) + (c.prompt.length > 240 ? "…" : "")
              : undefined,
            _previewResponse: c.response
              ? c.response.slice(0, 240) + (c.response.length > 240 ? "…" : "")
              : undefined,
          }
    )

  return NextResponse.json({ dates, entries: indexed, date: dateParam })
}
