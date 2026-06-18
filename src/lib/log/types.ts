// Structured logger primitives.
//
// Every log entry is a single JSON object that ends with a newline so a
// file sink trivially produces JSONL. Operational entries (info / warn /
// error) flow through `app.YYYY-MM-DD.jsonl`. Two special entry kinds
// get their own files because they are inspected differently and grow
// at very different rates:
//
//   - llm_call       → llm.YYYY-MM-DD.jsonl
//   - admin_action   → admin-actions.YYYY-MM-DD.jsonl
//
// The split keeps operational tail-and-grep workflows fast and avoids
// the giant-prompt-bodies-of-LLM-calls drowning short status lines.

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface BaseLogEntry {
  ts: string
  level: LogLevel
  msg: string
  requestId?: string
  user?: string
  route?: string
  source?: "server" | "client"
  // Free-form metadata. Sinks must redact this before persisting.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta?: Record<string, any>
}

export interface LLMCallEntry {
  kind: "llm_call"
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
  // Populated when LLM_LOG_FULL=true (default). Both already pass
  // through the redactor before they hit a sink.
  prompt?: string
  response?: string
}

export interface AdminActionEntry {
  kind: "admin_action"
  ts: string
  requestId?: string
  user?: string
  action: string
  // Optional fields used by specific actions. Free-form keeps the type
  // open as more admin features land.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta?: Record<string, any>
}

export type LogEntry = BaseLogEntry | LLMCallEntry | AdminActionEntry

export interface LogSink {
  // Called once per entry. Implementations must be best-effort: a sink
  // failure (disk full, permission denied) must never propagate up and
  // kill the request that triggered the log line.
  write(entry: LogEntry): void
}

export const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}
