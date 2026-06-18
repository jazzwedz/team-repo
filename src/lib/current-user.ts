// Resolve the active end-user identity from the incoming request.
//
// arch-tool is single-tenant by default (the SITE_PASSWORD gate is one
// shared password). When the storage backend is a shared filesystem and
// the deployment sits behind a corporate reverse proxy (nginx / IIS /
// Apache) that already authenticates the user — Kerberos, SAML, OIDC,
// header injection — the proxy is expected to inject the authenticated
// username into a request header. The header name is configurable so
// the same code works with different reverse-proxy conventions; the
// default is X-Forwarded-User (a de-facto standard).
//
// When no header is present, the identity is "anonymous". Edit locks
// and history sidecar entries will still work, they just won't tell
// users apart.

const DEFAULT_HEADER = "X-Forwarded-User"
const ANONYMOUS = "anonymous"

export function getUserHeaderName(): string {
  return process.env.USER_HEADER || DEFAULT_HEADER
}

export function getCurrentUser(request: Request): string {
  const headerName = getUserHeaderName()
  const value = request.headers.get(headerName)
  if (!value) return ANONYMOUS
  const trimmed = value.trim()
  if (!trimmed) return ANONYMOUS
  // Defensive: cap at a reasonable length so a malformed header can't
  // bloat lock files / history entries.
  return trimmed.slice(0, 120)
}

export { ANONYMOUS }
