// Shared diagnostics primitives for provider self-description and verbose
// probing. Providers describe their connection in sanitized form, then run
// a step-by-step probe (DNS → request → response → classify) so the
// Settings UI can pinpoint exactly where a connection is failing — not
// just that it failed.
//
// Secrets are never returned in full. Tokens are masked to a prefix+suffix
// hint, Basic auth blobs are not echoed back, and request headers are
// sanitized before they leave the server.

import { promises as dns } from "node:dns"

export type ErrorCategory =
  | "dns"
  | "tls"
  | "connect"
  | "auth-401"
  | "forbidden-403"
  | "not-found-404"
  | "rate-limit-429"
  | "server-5xx"
  | "http-other"
  | "parse"
  | "unknown"

export interface ProbeStepBase {
  step: "dns" | "request" | "response" | "classify"
  ok: boolean
  ms?: number
  detail?: string
  // Optional phase label. Used by multi-phase probes (e.g. OAuth →
  // gateway) so the UI can group the steps under a heading and the
  // analyst can tell which phase failed.
  phase?: string
  // Optional display override for the step's primary label. Filesystem
  // probes use this to surface "resolve / access / contents / write" in
  // the UI without polluting the canonical step taxonomy.
  label?: string
}

export interface DnsStep extends ProbeStepBase {
  step: "dns"
  address?: string
}

export interface RequestStep extends ProbeStepBase {
  step: "request"
  // HTTP-shaped probes always populate these. Non-HTTP probes (e.g.
  // filesystem checks) may omit them and rely on `label` + `detail` to
  // describe the operation.
  method?: string
  url?: string
  headers?: Record<string, string>
}

export interface ResponseStep extends ProbeStepBase {
  step: "response"
  status?: number
  statusText?: string
  bodyExcerpt?: string
}

export interface ClassifyStep extends ProbeStepBase {
  step: "classify"
  category: ErrorCategory
  hint: string
}

export type ProbeStep = DnsStep | RequestStep | ResponseStep | ClassifyStep

export interface ProbeTrace {
  ok: boolean
  totalMs: number
  steps: ProbeStep[]
}

// Mask a secret to a short hint. Preserves a few characters of prefix and
// suffix so users can tell two tokens apart, but exposes nothing usable.
export function maskSecret(value: string | undefined): string {
  if (!value) return ""
  if (value.length < 14) return "****"
  return `${value.slice(0, 6)}****${value.slice(-4)}`
}

// Mask bearer-style values inside a JSON-ish response body. Used before
// a token endpoint response excerpt enters a diagnostic trace, so a
// freshly-minted access_token never travels back to the browser. Best-
// effort regex over the conventional flat token JSON; nested envelopes
// can still slip through, so callers must also keep total excerpt
// length short.
export function redactBearerInJson(text: string): string {
  return text.replace(
    /"(access_token|id_token|refresh_token)"\s*:\s*"([^"]+)"/g,
    (_, key, value) => `"${key}":"${maskSecret(value)}"`
  )
}

// Sanitize request headers so we never echo a credential back to the
// client. Authorization, x-api-key, anthropic-version, cookie are masked;
// everything else passes through unchanged.
export function sanitizeHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase()
    if (lower === "authorization") {
      // "Basic abc..." or "Bearer xyz..." — keep the scheme, mask the rest.
      const space = v.indexOf(" ")
      if (space > 0) {
        out[k] = `${v.slice(0, space + 1)}${maskSecret(v.slice(space + 1))}`
      } else {
        out[k] = maskSecret(v)
      }
    } else if (lower === "x-api-key" || lower === "cookie") {
      out[k] = maskSecret(v)
    } else {
      out[k] = v
    }
  }
  return out
}

export function classifyHttpStatus(status: number): ErrorCategory {
  if (status === 401) return "auth-401"
  if (status === 403) return "forbidden-403"
  if (status === 404) return "not-found-404"
  if (status === 429) return "rate-limit-429"
  if (status >= 500) return "server-5xx"
  if (status >= 400) return "http-other"
  return "unknown"
}

export function hintFor(category: ErrorCategory, providerLabel: string): string {
  switch (category) {
    case "dns":
      return `DNS resolution failed. Check the base URL hostname for typos and that DNS is reachable.`
    case "tls":
      return `TLS handshake rejected — Node does not trust the server's certificate chain. On a corporate network with an internal CA, export the corp root CA as PEM and set NODE_EXTRA_CA_CERTS=/path/to/ca.pem before starting the app. Curl works without this because it trusts the OS cert store.`
    case "connect":
      return `Network connection failed (timeout, refused, host unreachable). Check firewall, VPN, that the host accepts HTTPS on the configured port, and that an HTTPS_PROXY is set if the corp requires one.`
    case "auth-401":
      return `Auth rejected. Check the credential is correct, not expired, and has the required scope on ${providerLabel}.`
    case "forbidden-403":
      return `Authenticated but not authorized. The token / account lacks permission to this resource on ${providerLabel}.`
    case "not-found-404":
      return `Endpoint or resource not found. Check the base URL, space identifier or repo name for ${providerLabel}.`
    case "rate-limit-429":
      return `Rate-limited by ${providerLabel}. Wait a few seconds and retry.`
    case "server-5xx":
      return `${providerLabel} returned a server error. Usually resolves on retry; check the provider status page.`
    case "parse":
      return `Response was not the expected JSON. Endpoint may be wrong or returning HTML (e.g. a login page).`
    case "http-other":
      return `Request rejected with a 4xx status. Inspect the response body for details.`
    default:
      return ""
  }
}

// Node TLS error codes — when seen, the failure is in the cert chain
// or hostname/SAN, not in the TCP layer. These flow up through fetch's
// err.cause and need to be surfaced explicitly because Node wraps them
// in a generic "fetch failed" at the outer level.
const TLS_ERROR_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "HOSTNAME_MISMATCH",
  "CERT_UNTRUSTED",
  "ERR_OSSL_PEM_NO_START_LINE",
  "ERR_TLS_HANDSHAKE_TIMEOUT",
  "ERR_SSL_WRONG_VERSION_NUMBER",
])

// Recursively walk an Error's `.cause` chain and pull out the deepest
// useful message plus any `code` and `syscall` Node attached.
interface FailureDetail {
  message: string
  code?: string
  syscall?: string
  isTls: boolean
}

function unwrapErrorCause(err: unknown): FailureDetail {
  const codes: string[] = []
  const messages: string[] = []
  let syscall: string | undefined

  let cur: unknown = err
  let guard = 0
  while (cur && guard < 8) {
    if (cur instanceof Error) {
      messages.push(cur.message)
      const anyErr = cur as Error & { code?: string; syscall?: string; cause?: unknown }
      if (anyErr.code) codes.push(anyErr.code)
      if (anyErr.syscall && !syscall) syscall = anyErr.syscall
      cur = anyErr.cause
    } else if (typeof cur === "object" && cur !== null) {
      const anyErr = cur as { message?: string; code?: string; syscall?: string; cause?: unknown }
      if (anyErr.message) messages.push(String(anyErr.message))
      if (anyErr.code) codes.push(String(anyErr.code))
      if (anyErr.syscall && !syscall) syscall = String(anyErr.syscall)
      cur = anyErr.cause
    } else {
      break
    }
    guard++
  }

  const code = codes.find((c) => c !== "UND_ERR_SOCKET" && c !== "ERR_FETCH_FAILED") || codes[0]
  const isTls = codes.some((c) => TLS_ERROR_CODES.has(c))
  // Prefer the deepest (most specific) message; "fetch failed" lives at
  // the outermost layer and tells the user nothing.
  const deepest = messages.reverse().find((m) => m && !/^fetch failed$/i.test(m)) || messages[0] || "Unknown error"
  return { message: deepest, code, syscall, isTls }
}

export function describeFetchFailure(err: unknown): string {
  const d = unwrapErrorCause(err)
  const parts: string[] = []
  if (d.code) parts.push(d.code)
  if (d.syscall) parts.push(`syscall=${d.syscall}`)
  const prefix = parts.length > 0 ? `[${parts.join(" ")}] ` : ""
  return `${prefix}${d.message}`
}

// Decide whether a fetch failure is TLS-level or connect-level.
// Walks the cause chain and looks for a known TLS error code.
export function classifyFetchFailure(err: unknown): "tls" | "connect" {
  return unwrapErrorCause(err).isTls ? "tls" : "connect"
}

// Resolve a hostname and return both the IP and the elapsed time. Throws
// the underlying DNS error on failure.
async function resolveHost(hostname: string): Promise<{ address: string; ms: number }> {
  const start = Date.now()
  const { address } = await dns.lookup(hostname)
  return { address, ms: Date.now() - start }
}

// Truncate a response body for transport. We never expose more than ~600
// chars to keep the UI responsive and avoid leaking large blobs.
function truncate(s: string, max = 600): string {
  if (s.length <= max) return s
  return s.slice(0, max) + `… (truncated, ${s.length - max} more chars)`
}

export interface HttpProbeOptions {
  method: string
  url: string
  // The full headers including the real credential — we sanitize them
  // before they enter the trace.
  headers: Record<string, string>
  body?: string
  providerLabel: string
}

// Run a single HTTP probe and assemble a four-step trace:
//   1. dns       — resolve the hostname
//   2. request   — record the (sanitized) URL + headers + method
//   3. response  — capture status, statusText, body excerpt
//   4. classify  — only when !ok; categorise and add a hint
//
// On total success we return three steps (no classify). On failure we
// stop at the failing step but always append a classify with the best
// category we can infer.
export async function runHttpProbe(opts: HttpProbeOptions): Promise<ProbeTrace> {
  const t0 = Date.now()
  const steps: ProbeStep[] = []

  // 1. DNS
  let host: string
  try {
    host = new URL(opts.url).hostname
  } catch {
    steps.push({
      step: "dns",
      ok: false,
      detail: `Invalid URL: ${opts.url}`,
    })
    steps.push({
      step: "classify",
      ok: false,
      category: "dns",
      hint: `The configured base URL could not be parsed.`,
    })
    return { ok: false, totalMs: Date.now() - t0, steps }
  }

  try {
    const r = await resolveHost(host)
    steps.push({
      step: "dns",
      ok: true,
      ms: r.ms,
      address: r.address,
      detail: `${host} → ${r.address}`,
    })
  } catch (err) {
    steps.push({
      step: "dns",
      ok: false,
      ms: 0,
      detail: err instanceof Error ? err.message : String(err),
    })
    steps.push({
      step: "classify",
      ok: false,
      category: "dns",
      hint: hintFor("dns", opts.providerLabel),
    })
    return { ok: false, totalMs: Date.now() - t0, steps }
  }

  // 2. Request (sanitized record, before sending)
  steps.push({
    step: "request",
    ok: true,
    method: opts.method,
    url: opts.url,
    headers: sanitizeHeaders(opts.headers),
  })

  // 3. Response (the actual network call)
  const reqStart = Date.now()
  let res: Response
  try {
    res = await fetch(opts.url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
    })
  } catch (err) {
    // Node's fetch wraps the real reason (TLS code, ECONNREFUSED,
    // ECONNRESET, ENETUNREACH, ETIMEDOUT, etc.) inside err.cause.
    // Without unwrapping, every connect-level failure looks like the
    // generic "fetch failed", which is useless in a corp debug.
    const detail = describeFetchFailure(err)
    const category = classifyFetchFailure(err)
    steps.push({
      step: "response",
      ok: false,
      ms: Date.now() - reqStart,
      detail,
    })
    steps.push({
      step: "classify",
      ok: false,
      category,
      hint: hintFor(category, opts.providerLabel),
    })
    return { ok: false, totalMs: Date.now() - t0, steps }
  }

  const bodyText = await res.text().catch(() => "")
  steps.push({
    step: "response",
    ok: res.ok,
    ms: Date.now() - reqStart,
    status: res.status,
    statusText: res.statusText,
    bodyExcerpt: truncate(bodyText),
  })

  if (res.ok) {
    return { ok: true, totalMs: Date.now() - t0, steps }
  }

  const category = classifyHttpStatus(res.status)
  steps.push({
    step: "classify",
    ok: false,
    category,
    hint: hintFor(category, opts.providerLabel),
  })
  return { ok: false, totalMs: Date.now() - t0, steps }
}
