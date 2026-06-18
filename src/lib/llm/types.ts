import type { ProbeTrace } from "../diagnostics"

export interface LLMCompleteOptions {
  prompt: string
  maxTokens: number
}

export interface LLMDescribe {
  provider: "anthropic" | "openai-compatible"
  baseUrl: string
  model: string
  authScheme: string
  authHint: string
  endpointTemplate: string
}

export interface LLMProvider {
  readonly name: string
  readonly model: string

  // Real completion call used by the app.
  complete(opts: LLMCompleteOptions): Promise<string>

  // Sanitized self-description for the Settings UI. Synchronous, never
  // touches the network. Secrets are masked to a prefix+suffix hint.
  describe(): LLMDescribe

  // Verbose probe: DNS → request → response → classify trace. Returns the
  // full step list so the UI can pinpoint exactly where a failing
  // connection breaks. Performs a real 1-token completion call.
  probe(): Promise<ProbeTrace>
}
