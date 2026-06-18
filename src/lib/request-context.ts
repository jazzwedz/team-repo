// Per-request context — user identity, request id, current route.
// Anything we want available below the route handler (the logger, the
// filesystem provider's history sidecar) reads it through the helpers
// below instead of plumbing it through every signature.
//
// Backed by Node's AsyncLocalStorage (https://nodejs.org/api/async_context.html)
// so the value follows the async chain naturally. Outside any context
// (background jobs, startup paths, tests), the helpers return
// reasonable defaults.

import { AsyncLocalStorage } from "node:async_hooks"
import { ANONYMOUS } from "./current-user"

interface RequestContext {
  user: string
  requestId?: string
  route?: string
}

const store = new AsyncLocalStorage<RequestContext>()

export function withRequestContext<T>(
  ctx: RequestContext,
  fn: () => Promise<T>
): Promise<T> {
  return store.run(ctx, fn)
}

export function getRequestUser(): string {
  return store.getStore()?.user ?? ANONYMOUS
}

export function getRequestId(): string | undefined {
  return store.getStore()?.requestId
}

export function getRequestRoute(): string | undefined {
  return store.getStore()?.route
}
