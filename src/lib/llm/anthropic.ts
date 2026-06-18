import Anthropic from "@anthropic-ai/sdk"
import type { LLMProvider, LLMCompleteOptions, LLMDescribe } from "./types"
import { maskSecret, runHttpProbe, type ProbeTrace } from "../diagnostics"

const ANTHROPIC_BASE_URL = "https://api.anthropic.com"
const ANTHROPIC_API_VERSION = "2023-06-01"

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic"
  readonly model: string
  private client: Anthropic
  private apiKey: string

  constructor(opts: { apiKey: string; model: string }) {
    this.client = new Anthropic({ apiKey: opts.apiKey })
    this.apiKey = opts.apiKey
    this.model = opts.model
  }

  async complete(opts: LLMCompleteOptions): Promise<string> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: opts.maxTokens,
      messages: [{ role: "user", content: opts.prompt }],
    })
    return message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
  }

  describe(): LLMDescribe {
    return {
      provider: "anthropic",
      baseUrl: ANTHROPIC_BASE_URL,
      model: this.model,
      authScheme: "x-api-key",
      authHint: maskSecret(this.apiKey),
      endpointTemplate: "/v1/messages",
    }
  }

  async probe(): Promise<ProbeTrace> {
    return runHttpProbe({
      method: "POST",
      url: `${ANTHROPIC_BASE_URL}/v1/messages`,
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: "user", content: "Hi" }],
      }),
      providerLabel: "Anthropic",
    })
  }
}
