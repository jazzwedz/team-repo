// File sink — writes JSON lines into per-day, per-stream files under
// LOG_PATH. Three streams, three filename patterns:
//
//   app.YYYY-MM-DD.jsonl              operational entries (debug/info/warn/error)
//   llm.YYYY-MM-DD.jsonl              kind=llm_call entries (large)
//   admin-actions.YYYY-MM-DD.jsonl    kind=admin_action entries (audit)
//
// The split keeps tail+grep on the operational log fast even when LLM
// calls run thousands per day. The sink uses appendFileSync for two
// reasons: it is atomic enough that two concurrent requests do not
// interleave inside a single line, and any I/O error is contained to a
// single entry instead of leaving an unflushed buffer behind on
// process exit.

import { appendFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import type { LogEntry, LogSink } from "../types"

export class FileSink implements LogSink {
  private root: string
  private dirReady = false

  constructor(root: string) {
    this.root = root
  }

  write(entry: LogEntry): void {
    try {
      this.ensureDir()
      const stream = streamFor(entry)
      const file = path.join(
        this.root,
        `${stream}.${todayUtc()}.jsonl`
      )
      appendFileSync(file, JSON.stringify(entry) + "\n", { encoding: "utf-8" })
    } catch {
      // Best-effort — fall back to stdout on FS failure so the line is
      // not lost entirely.
      try {
        process.stderr.write(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: "warn",
            msg: "FileSink write failed; entry routed to stderr",
            entry,
          }) + "\n"
        )
      } catch {
        // give up
      }
    }
  }

  private ensureDir(): void {
    if (this.dirReady) return
    mkdirSync(this.root, { recursive: true })
    this.dirReady = true
  }
}

function streamFor(entry: LogEntry): string {
  if ("kind" in entry) {
    if (entry.kind === "llm_call") return "llm"
    if (entry.kind === "admin_action") return "admin-actions"
  }
  return "app"
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}
