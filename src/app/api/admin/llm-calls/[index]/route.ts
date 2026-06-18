// GET /api/admin/llm-calls/[index]?date=YYYY-MM-DD
//
// Returns one full LLM call entry by its zero-based position in the
// llm.YYYY-MM-DD.jsonl file. The index is opaque — the list endpoint
// produces it; the detail endpoint reads it back. We use the position
// instead of a synthetic id because the entries do not carry one and
// reusing the position is stable across opens of the same file.

import { NextResponse } from "next/server"
import { getLogRoot, isLLMCall, readLogFile } from "@/lib/log/reader"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ index: string }> }
) {
  const { index } = await params
  const url = new URL(request.url)
  const date = url.searchParams.get("date") || ""
  if (!date) {
    return NextResponse.json({ error: "Missing ?date" }, { status: 400 })
  }
  const i = parseInt(index, 10)
  if (Number.isNaN(i) || i < 0) {
    return NextResponse.json({ error: "Invalid index" }, { status: 400 })
  }
  if (!getLogRoot()) {
    return NextResponse.json({ error: "LOG_SINK is stdout-only" }, { status: 404 })
  }
  const all = await readLogFile("llm", date)
  const calls = all.filter(isLLMCall)
  if (i >= calls.length) {
    return NextResponse.json({ error: "Index out of range" }, { status: 404 })
  }
  return NextResponse.json(calls[i])
}
