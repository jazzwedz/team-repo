// Turn a low-level `fetch()` failure into a message that says WHAT failed
// and WHY. Node throws `TypeError: fetch failed` for any transport-level
// problem (DNS, refused, reset, connect timeout, TLS) and hides the real
// reason in `error.cause` — so the bare message ("fetch failed") is
// useless for diagnosis. This unwraps the cause (its `code` and message)
// and names the host we were trying to reach.

export function describeFetchError(err: unknown, target: string): string {
  if (!(err instanceof Error)) return `Could not reach ${target}: ${String(err)}`
  // Only rewrite genuine transport failures; pass through our own
  // already-descriptive errors (e.g. "LLM request failed: 503 …").
  if (err.message !== "fetch failed" && err.message !== "Failed to fetch") {
    return err.message
  }
  const cause = (err as { cause?: unknown }).cause
  let code = ""
  let detail = ""
  if (cause && typeof cause === "object") {
    const c = cause as { code?: unknown; message?: unknown }
    if (typeof c.code === "string") code = ` [${c.code}]`
    if (typeof c.message === "string" && c.message) detail = ` — ${c.message}`
  }
  return `Could not reach ${target}${code}${detail}. Check the network/VPN, the gateway URL, and that the host is resolvable.`
}
