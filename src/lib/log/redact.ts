// Secret redaction for log entries.
//
// Logs end up on disk and in admin UIs that any logged-in user can
// inspect (per the all-users-are-admin policy). Anything that smells
// like a credential gets masked before it leaves the in-memory entry.
// The patterns are intentionally aggressive — false positives just
// produce `****` in place of legitimate text, which is acceptable;
// false negatives leak credentials, which is not.

import { maskSecret } from "../diagnostics"

// Header / field names whose VALUE is always a secret in our codebase.
const SECRET_HEADER_KEYS = new Set([
  "authorization",
  "x-api-key",
  "cookie",
  "set-cookie",
  "proxy-authorization",
])

// JSON property keys whose value gets masked anywhere in a serialized
// object. Matches a flat token-response shape AND nested objects.
const SECRET_FIELD_KEYS = new Set([
  "access_token",
  "id_token",
  "refresh_token",
  "client_secret",
  "api_key",
  "apikey",
  "password",
  "pat",
  "secret",
  "token",
])

// Patterns matched against arbitrary string content. The order matters
// for overlapping prefixes (Bearer / sk-/ pat-).
const SECRET_PATTERNS: Array<{ re: RegExp; replace: (m: string) => string }> = [
  // Bearer / Basic header values inside arbitrary text
  {
    re: /\b(Bearer|Basic)\s+[A-Za-z0-9\-_=:.~+/]+/g,
    replace: (m) => `${m.split(/\s+/)[0]} ${maskSecret(m.split(/\s+/)[1] || "")}`,
  },
  // OpenAI-style API keys
  { re: /\bsk-[A-Za-z0-9_\-]{16,}/g, replace: (m) => maskSecret(m) },
  // GitHub fine-grained PATs
  { re: /\bgithub_pat_[A-Za-z0-9_]{16,}/g, replace: (m) => maskSecret(m) },
  // Generic high-entropy tokens (length 32+ of base64-url chars)
  { re: /\b[A-Za-z0-9_\-]{40,}/g, replace: (m) => maskSecret(m) },
]

// Redact known-secret fields in JSON-ish text.
export function redactJsonText(text: string): string {
  if (!text) return text
  // Field-key based pass — handles flat JSON. Nested handled by JSON
  // round-trip below.
  let out = text.replace(
    /"([A-Za-z0-9_]+)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g,
    (full, key: string, value: string) => {
      if (SECRET_FIELD_KEYS.has(key.toLowerCase())) {
        return `"${key}":"${maskSecret(value)}"`
      }
      return full
    }
  )
  // Pattern-based pass — catches values that escaped the key check
  // (e.g. tokens embedded in error messages or prose).
  for (const p of SECRET_PATTERNS) {
    out = out.replace(p.re, p.replace)
  }
  return out
}

export function redactHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase()
    if (SECRET_HEADER_KEYS.has(lower)) {
      // For Authorization, preserve the scheme so analysts can tell
      // Bearer / Basic apart at a glance.
      const space = v.indexOf(" ")
      if (lower === "authorization" && space > 0) {
        out[k] = `${v.slice(0, space + 1)}${maskSecret(v.slice(space + 1))}`
      } else {
        out[k] = maskSecret(v)
      }
    } else {
      out[k] = v
    }
  }
  return out
}

// Deep walk a meta object and redact any string field whose key is a
// known secret. The walk also redacts string VALUES via the pattern
// passes so a stack trace embedded in an error message gets cleaned.
export function redactMeta(input: unknown, depth = 0): unknown {
  if (depth > 8) return input // guard against pathological cycles
  if (input === null || input === undefined) return input
  if (typeof input === "string") return redactJsonText(input)
  if (typeof input !== "object") return input
  if (Array.isArray(input)) {
    return input.map((v) => redactMeta(v, depth + 1))
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (SECRET_FIELD_KEYS.has(k.toLowerCase())) {
      out[k] = typeof v === "string" ? maskSecret(v) : "****"
      continue
    }
    out[k] = redactMeta(v, depth + 1)
  }
  return out
}
