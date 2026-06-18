// Read-side helpers for the Admin console — list available JSONL log
// files under LOG_PATH and stream individual entries. Best-effort: a
// missing LOG_PATH or stream simply yields an empty list rather than
// blowing up the admin UI.

import { promises as fsp } from "node:fs"
import * as path from "node:path"
import type { LogEntry, LLMCallEntry, AdminActionEntry, BaseLogEntry } from "./types"

export type LogStream = "app" | "llm" | "admin-actions"

const FILE_RE: Record<LogStream, RegExp> = {
  app: /^app\.(\d{4}-\d{2}-\d{2})\.jsonl$/,
  llm: /^llm\.(\d{4}-\d{2}-\d{2})\.jsonl$/,
  "admin-actions": /^admin-actions\.(\d{4}-\d{2}-\d{2})\.jsonl$/,
}

export function getLogRoot(): string | null {
  // File sink uses LOG_PATH; for stdout-only deployments there is no
  // disk archive to browse.
  const sink = (process.env.LOG_SINK || "stdout").toLowerCase().trim()
  if (sink !== "file" && sink !== "both") return null
  return process.env.LOG_PATH || "./logs"
}

export async function listLogDates(stream: LogStream): Promise<string[]> {
  const root = getLogRoot()
  if (!root) return []
  let entries: string[]
  try {
    entries = await fsp.readdir(root)
  } catch {
    return []
  }
  const re = FILE_RE[stream]
  const dates: string[] = []
  for (const name of entries) {
    const m = name.match(re)
    if (m) dates.push(m[1])
  }
  // Newest first so the admin lands on today's file.
  dates.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
  return dates
}

export async function readLogFile(
  stream: LogStream,
  date: string
): Promise<LogEntry[]> {
  const root = getLogRoot()
  if (!root) return []
  const filename = `${stream}.${date}.jsonl`
  const full = path.join(root, filename)
  let raw: string
  try {
    raw = await fsp.readFile(full, "utf-8")
  } catch {
    return []
  }
  const out: LogEntry[] = []
  for (const line of raw.split(/\n+/)) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // skip malformed lines — never block the admin UI
    }
  }
  return out
}

// Stream-specific narrowing helpers — the route handler that returns
// LLM calls only cares about LLMCallEntry, etc.
export function isLLMCall(e: LogEntry): e is LLMCallEntry {
  return "kind" in e && e.kind === "llm_call"
}
export function isAdminAction(e: LogEntry): e is AdminActionEntry {
  return "kind" in e && e.kind === "admin_action"
}
export function isAppEntry(e: LogEntry): e is BaseLogEntry {
  return !("kind" in e)
}
