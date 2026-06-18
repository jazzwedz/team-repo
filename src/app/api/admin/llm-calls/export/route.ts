// POST /api/admin/llm-calls/export
// Body: { date: "YYYY-MM-DD", indices: [0, 3, 7, ...], format: "fine-tune" | "raw" }
//
// "fine-tune" emits one JSONL line per entry shaped as the OpenAI fine-
// tuning input format: { messages: [{role: "user", content: prompt},
// {role: "assistant", content: response}] }. Skips failed calls and
// entries where prompt/response are missing (LLM_LOG_FULL=summary).
//
// "raw" emits the full entries as-is. Useful when an analyst wants a
// reproducible chunk to hand to a different tool.
//
// The response is text/plain so the browser downloads it directly.

import { NextResponse } from "next/server"
import { getLogRoot, isLLMCall, readLogFile } from "@/lib/log/reader"
import { getLogger } from "@/lib/log"
import { withRouteContext } from "@/lib/route-context"

interface Body {
  date?: string
  indices?: number[]
  format?: "fine-tune" | "raw"
}

export async function POST(request: Request) {
  return withRouteContext(request, async () => {
    let body: Body
    try {
      body = (await request.json()) as Body
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }
    const date = body.date
    const indices = Array.isArray(body.indices) ? body.indices : []
    const format = body.format === "raw" ? "raw" : "fine-tune"
    if (!date || indices.length === 0) {
      return NextResponse.json(
        { error: "Missing date or indices" },
        { status: 400 }
      )
    }
    if (!getLogRoot()) {
      return NextResponse.json(
        { error: "LOG_SINK is stdout-only" },
        { status: 404 }
      )
    }
    const all = await readLogFile("llm", date)
    const calls = all.filter(isLLMCall)
    const lines: string[] = []
    let skipped = 0
    for (const i of indices) {
      if (typeof i !== "number" || i < 0 || i >= calls.length) {
        skipped++
        continue
      }
      const c = calls[i]
      if (format === "raw") {
        lines.push(JSON.stringify(c))
        continue
      }
      // fine-tune
      if (!c.ok || !c.prompt || !c.response) {
        skipped++
        continue
      }
      lines.push(
        JSON.stringify({
          messages: [
            { role: "user", content: c.prompt },
            { role: "assistant", content: c.response },
          ],
        })
      )
    }
    getLogger().adminAction("llm.export", {
      date,
      format,
      requested: indices.length,
      exported: lines.length,
      skipped,
    })
    const body_out = lines.join("\n") + (lines.length > 0 ? "\n" : "")
    return new NextResponse(body_out, {
      status: 200,
      headers: {
        "Content-Type": "application/jsonl",
        "Content-Disposition": `attachment; filename="llm-calls-${date}.jsonl"`,
        "X-Exported-Count": String(lines.length),
        "X-Skipped-Count": String(skipped),
      },
    })
  })
}
