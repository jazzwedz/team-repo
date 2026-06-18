// Logger factory.
//
// Reads LOG_LEVEL, LOG_SINK and LOG_PATH from the environment, builds
// the configured sink, and returns a thin Logger object the rest of
// the codebase calls. The factory is sync and side-effect-free until
// the first write; safe to import anywhere.

import type {
  LogEntry,
  LogLevel,
  LogSink,
  LLMCallEntry,
  AdminActionEntry,
} from "./types"
import { LEVEL_ORDER } from "./types"
import { StdoutSink } from "./sinks/stdout"
import { FileSink } from "./sinks/file"
import { MultiSink } from "./sinks/multi"
import { redactJsonText, redactMeta } from "./redact"
import { getRequestUser, getRequestId, getRequestRoute } from "../request-context"

export type {
  LogLevel,
  LogEntry,
  BaseLogEntry,
  LLMCallEntry,
  AdminActionEntry,
  LogSink,
} from "./types"

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void
  info(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
  error(msg: string, meta?: Record<string, unknown>): void
  llmCall(entry: Omit<LLMCallEntry, "kind" | "ts" | "requestId" | "user" | "route">): void
  adminAction(action: string, meta?: Record<string, unknown>): void
}

function parseLevel(value: string | undefined): LogLevel {
  const v = (value || "").toLowerCase().trim()
  if (v === "debug" || v === "info" || v === "warn" || v === "error") return v
  return "info"
}

function buildSink(): LogSink {
  const sinkEnv = (process.env.LOG_SINK || "stdout").toLowerCase().trim()
  const stdout = new StdoutSink()
  if (sinkEnv === "stdout") return stdout
  const path = process.env.LOG_PATH || "./logs"
  const file = new FileSink(path)
  if (sinkEnv === "file") return file
  // both / unknown → fan out so stdout still flows to container log shippers.
  return new MultiSink([stdout, file])
}

let _logger: Logger | null = null
const _sink: LogSink = buildSink()
const _threshold: number = LEVEL_ORDER[parseLevel(process.env.LOG_LEVEL)]
const _llmLogFull: boolean =
  (process.env.LLM_LOG_FULL || "true").toLowerCase().trim() !== "summary"

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= _threshold
}

function baseFields() {
  return {
    ts: new Date().toISOString(),
    requestId: getRequestId(),
    user: getRequestUser(),
    route: getRequestRoute(),
  }
}

function safeMeta(meta: Record<string, unknown> | undefined) {
  if (!meta) return undefined
  return redactMeta(meta) as Record<string, unknown>
}

function emit(entry: LogEntry): void {
  try {
    _sink.write(entry)
  } catch {
    // never propagate
  }
}

function log(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return
  emit({
    ...baseFields(),
    level,
    source: "server",
    msg: redactJsonText(msg),
    meta: safeMeta(meta),
  })
}

export function getLogger(): Logger {
  if (_logger) return _logger
  _logger = {
    debug: (msg, meta) => log("debug", msg, meta),
    info: (msg, meta) => log("info", msg, meta),
    warn: (msg, meta) => log("warn", msg, meta),
    error: (msg, meta) => log("error", msg, meta),
    llmCall: (entry) => {
      const base = baseFields()
      const full: LLMCallEntry = {
        kind: "llm_call",
        ts: base.ts,
        requestId: base.requestId,
        user: base.user,
        route: base.route,
        provider: entry.provider,
        model: entry.model,
        promptChars: entry.promptChars,
        responseChars: entry.responseChars,
        latencyMs: entry.latencyMs,
        ok: entry.ok,
        error: entry.error ? redactJsonText(entry.error) : undefined,
        prompt: _llmLogFull && entry.prompt ? redactJsonText(entry.prompt) : undefined,
        response:
          _llmLogFull && entry.response ? redactJsonText(entry.response) : undefined,
      }
      emit(full)
    },
    adminAction: (action, meta) => {
      const base = baseFields()
      const entry: AdminActionEntry = {
        kind: "admin_action",
        ts: base.ts,
        requestId: base.requestId,
        user: base.user,
        action,
        meta: safeMeta(meta),
      }
      emit(entry)
    },
  }
  return _logger
}

// Test seam — drop the singleton so a freshly-modified env is picked
// up. Real deployments restart the process to change LOG_*.
export function resetLogger(): void {
  _logger = null
}
