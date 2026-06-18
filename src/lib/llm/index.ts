// LLM factory — selects a provider based on the LLM_PROVIDER env var.
//
//   LLM_PROVIDER=anthropic           → AnthropicProvider (default)
//   LLM_PROVIDER=openai-compatible   → OpenAICompatibleProvider
//     (also accepts: "openai" — same thing; the protocol, not the vendor)
//
// The OpenAI-compatible adapter covers any gateway that speaks the Chat
// Completions protocol: OpenAI native, Azure OpenAI, OpenRouter, Together,
// Groq, LiteLLM, Portkey, Cloudflare AI Gateway, Ollama, LM Studio, vllm,
// and enterprise gateways that proxy one of the above behind an identity
// provider (OAuth 2.0 client_credentials).
//
// Auth mode for the openai-compatible adapter is implied by which env
// vars are set:
//   LLM_API_KEY                    → static bearer token (default)
//   LLM_OAUTH_TOKEN_URL + creds    → OAuth 2.0 client_credentials
//
// Model is read from `config.yaml` (`llm.model`) in the arch-data repo
// when present, with an env-var fallback (ANTHROPIC_MODEL or LLM_MODEL)
// and a hardcoded default. Provider type stays in env because changing it
// usually implies new secrets that also need a redeploy.

import { AnthropicProvider } from "./anthropic"
import { OpenAICompatibleProvider } from "./openai-compatible"
import type { LLMProvider } from "./types"
import { loadConfig } from "../config"
import { withLogging } from "./with-logging"

export type { LLMProvider, LLMCompleteOptions, LLMDescribe } from "./types"

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514"
const DEFAULT_OPENAI_MODEL = "gpt-4o"

let _provider: LLMProvider | null = null

export type LLMProviderName = "anthropic" | "openai-compatible"

export function getLLMProviderName(): LLMProviderName {
  const raw = (process.env.LLM_PROVIDER || "anthropic").toLowerCase().trim()
  if (raw === "openai" || raw === "openai-compatible") return "openai-compatible"
  return "anthropic"
}

// True when the active provider has enough env to attempt a connection.
// The healthcheck route uses this to short-circuit before any network
// call when the operator has not finished provisioning credentials.
export function isLLMConfigured(): boolean {
  const provider = getLLMProviderName()
  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY
    return !!key && !key.includes("placeholder")
  }
  if (!process.env.LLM_BASE_URL) return false
  if (process.env.LLM_OAUTH_TOKEN_URL) {
    return !!(
      process.env.LLM_OAUTH_CLIENT_ID && process.env.LLM_OAUTH_CLIENT_SECRET
    )
  }
  return !!process.env.LLM_API_KEY
}

export const LLM_DISABLED_MESSAGE =
  "AI features are not enabled. Set ANTHROPIC_API_KEY, or LLM_PROVIDER=openai-compatible with LLM_BASE_URL and either LLM_API_KEY (static) or LLM_OAUTH_TOKEN_URL + LLM_OAUTH_CLIENT_ID + LLM_OAUTH_CLIENT_SECRET (OAuth) — see .env.local.example."

export async function getLLM(): Promise<LLMProvider> {
  if (_provider) return _provider

  const provider = getLLMProviderName()
  const config = await loadConfig()
  const configModel = config.llm?.model

  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey || apiKey.includes("placeholder")) {
      throw new Error(LLM_DISABLED_MESSAGE)
    }
    const model = configModel || process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL
    _provider = withLogging(new AnthropicProvider({ apiKey, model }))
    return _provider
  }

  const baseUrl = process.env.LLM_BASE_URL
  if (!baseUrl) {
    throw new Error(LLM_DISABLED_MESSAGE)
  }
  const model = configModel || process.env.LLM_MODEL || DEFAULT_OPENAI_MODEL

  const tokenUrl = process.env.LLM_OAUTH_TOKEN_URL
  if (tokenUrl) {
    const clientId = process.env.LLM_OAUTH_CLIENT_ID
    const clientSecret = process.env.LLM_OAUTH_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      throw new Error(
        "OAuth mode requires LLM_OAUTH_CLIENT_ID and LLM_OAUTH_CLIENT_SECRET."
      )
    }
    _provider = withLogging(
      new OpenAICompatibleProvider({
        baseUrl,
        model,
        auth: {
          kind: "oauth",
          oauth: {
            tokenUrl,
            clientId,
            clientSecret,
            scope: process.env.LLM_OAUTH_SCOPE || undefined,
            audience: process.env.LLM_OAUTH_AUDIENCE || undefined,
          },
        },
      })
    )
    return _provider
  }

  const apiKey = process.env.LLM_API_KEY
  if (!apiKey) {
    throw new Error(LLM_DISABLED_MESSAGE)
  }
  _provider = withLogging(
    new OpenAICompatibleProvider({
      baseUrl,
      model,
      auth: { kind: "static", apiKey },
    })
  )
  return _provider
}

// For tests / Settings page refresh after config or env change.
export function resetLLMProvider(): void {
  _provider = null
}

// Returns the env-var names that should be set for the current provider
// selection but are missing. Used by the healthcheck endpoint to render a
// "not configured — set X, Y, Z" message before any network call.
export function missingLLMEnvVars(): string[] {
  const provider = getLLMProviderName()
  if (provider === "anthropic") {
    const k = process.env.ANTHROPIC_API_KEY
    return !k || k.includes("placeholder") ? ["ANTHROPIC_API_KEY"] : []
  }
  const missing: string[] = []
  if (!process.env.LLM_BASE_URL) missing.push("LLM_BASE_URL")
  if (process.env.LLM_OAUTH_TOKEN_URL) {
    if (!process.env.LLM_OAUTH_CLIENT_ID) missing.push("LLM_OAUTH_CLIENT_ID")
    if (!process.env.LLM_OAUTH_CLIENT_SECRET) missing.push("LLM_OAUTH_CLIENT_SECRET")
  } else if (!process.env.LLM_API_KEY) {
    missing.push(
      "LLM_API_KEY (or LLM_OAUTH_TOKEN_URL + LLM_OAUTH_CLIENT_ID + LLM_OAUTH_CLIENT_SECRET for OAuth)"
    )
  }
  return missing
}
