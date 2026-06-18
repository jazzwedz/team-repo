// Decorator that wraps any LLMProvider so every complete() call
// produces a structured llm_call log entry — full prompt + response
// when LLM_LOG_FULL=true (default), summary metadata only when
// LLM_LOG_FULL=summary. Failures are still logged with the error
// message and the latency, so an admin can grep for slow / failing
// calls in the Admin console.
//
// The wrapper preserves describe() and probe() — diagnostics keep
// their pre-LLM probe semantics, no double round-trip.

import type { LLMProvider, LLMCompleteOptions } from "./types"
import type { ProbeTrace } from "../diagnostics"
import { getLogger } from "../log"

// Replace unpaired UTF-16 surrogates with U+FFFD. Catalog/component data
// can contain a broken character (half an emoji, a truncated paste),
// which serialises to JSON the Anthropic API rejects with
// "invalid high surrogate in string". Cleaning the prompt centrally here
// protects every AI feature (compose, generate, DSD, coach).
function toWellFormedPrompt(s: string): string {
  const maybe = s as unknown as { toWellFormed?: () => string }
  if (typeof maybe.toWellFormed === "function") return maybe.toWellFormed()
  return s.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "�"
  )
}

export function withLogging(inner: LLMProvider): LLMProvider {
  const log = getLogger()
  return {
    name: inner.name,
    model: inner.model,
    describe: () => inner.describe(),
    probe: (): Promise<ProbeTrace> => inner.probe(),
    async complete(rawOpts: LLMCompleteOptions): Promise<string> {
      const opts: LLMCompleteOptions = { ...rawOpts, prompt: toWellFormedPrompt(rawOpts.prompt) }
      const startedAt = Date.now()
      try {
        const response = await inner.complete(opts)
        log.llmCall({
          provider: inner.name,
          model: inner.model,
          promptChars: opts.prompt.length,
          responseChars: response.length,
          latencyMs: Date.now() - startedAt,
          ok: true,
          prompt: opts.prompt,
          response,
        })
        return response
      } catch (err) {
        log.llmCall({
          provider: inner.name,
          model: inner.model,
          promptChars: opts.prompt.length,
          responseChars: 0,
          latencyMs: Date.now() - startedAt,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          prompt: opts.prompt,
        })
        throw err
      }
    },
  }
}
