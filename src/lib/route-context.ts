// Glue between Next.js route handlers and the request-scoped context
// the rest of the codebase reads through AsyncLocalStorage.
//
// Each route handler that wants logger + lock + history sidecar
// integration wraps its body in `withRouteContext(request, fn)`. The
// helper:
//   - reads the user from the configured X-Forwarded-User-style header
//   - reuses an upstream x-request-id when the reverse proxy set one,
//     otherwise mints a fresh UUID so every log line in the request
//     chain shares a correlation id
//   - records the URL path so the logger can show `route` without
//     every caller having to repeat it
//
// Handlers stay thin — `return withRouteContext(req, async () => { ... })`.

import { randomUUID } from "node:crypto"
import { withRequestContext } from "./request-context"
import { getCurrentUser } from "./current-user"
import { getLogger } from "./log"

export function withRouteContext<T>(
  request: Request,
  fn: () => Promise<T>
): Promise<T> {
  const user = getCurrentUser(request)
  const headerId = request.headers.get("x-request-id")
  const requestId = (headerId && headerId.slice(0, 80)) || randomUUID()
  let route: string | undefined
  try {
    route = new URL(request.url).pathname
  } catch {
    // ignore
  }
  return withRequestContext({ user, requestId, route }, async () => {
    // Auto-log one operational entry per request so the Admin console's
    // Operational tab actually shows traffic. Mutating methods are
    // logged at info, read-only at debug — default LOG_LEVEL=info hides
    // GET flooding from a catalog page reload but still surfaces every
    // save/delete/import. Set LOG_LEVEL=debug to see GETs too.
    const method = (request.method || "GET").toUpperCase()
    const level: "debug" | "info" =
      method === "GET" || method === "HEAD" ? "debug" : "info"
    const log = getLogger()
    if (level === "info") log.info(`${method} ${route || ""}`)
    else log.debug(`${method} ${route || ""}`)
    return fn()
  })
}
