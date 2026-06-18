import type { LLMProvider, LLMCompleteOptions, LLMDescribe } from "./types"
import {
  classifyFetchFailure,
  classifyHttpStatus,
  describeFetchFailure,
  hintFor,
  maskSecret,
  redactBearerInJson,
  runHttpProbe,
  type ProbeStep,
  type ProbeTrace,
} from "../diagnostics"
import {
  OAuthTokenProvider,
  type OAuthClientCredentialsConfig,
} from "./oauth-token"
import { promises as dns } from "node:dns"

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>
  error?: { message?: string }
}

// Either a static API key (default) or a generic OAuth 2.0
// client_credentials grant against an identity provider. The OAuth
// path works with any standards-compliant IdP — the token URL is
// explicit and the adapter does not assume any particular vendor.
type AuthConfig =
  | { kind: "static"; apiKey: string }
  | { kind: "oauth"; provider: OAuthTokenProvider }

export interface OpenAICompatibleConstructorOpts {
  baseUrl: string
  model: string
  auth:
    | { kind: "static"; apiKey: string }
    | { kind: "oauth"; oauth: OAuthClientCredentialsConfig }
}

// OpenAI-compatible Chat Completions adapter.
// Works with any gateway or service that exposes the OpenAI Chat Completions
// protocol: OpenAI native, Azure OpenAI, OpenRouter, Together, Groq, LiteLLM,
// Portkey, Cloudflare AI Gateway, Ollama, LM Studio, vllm, and enterprise
// gateways that proxy one of the above behind an identity provider.
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = "openai-compatible"
  readonly model: string
  private baseUrl: string
  private auth: AuthConfig

  constructor(opts: OpenAICompatibleConstructorOpts) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "")
    this.model = opts.model
    if (opts.auth.kind === "static") {
      this.auth = { kind: "static", apiKey: opts.auth.apiKey }
    } else {
      this.auth = {
        kind: "oauth",
        provider: new OAuthTokenProvider(opts.auth.oauth),
      }
    }
  }

  async complete(opts: LLMCompleteOptions): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`
    const body = JSON.stringify({
      model: this.model,
      max_tokens: opts.maxTokens,
      messages: [{ role: "user", content: opts.prompt }],
    })

    let bearer = await this.acquireBearer()
    let res = await this.postChat(url, bearer, body)

    // In OAuth mode, 401 can mean the token expired between cache and
    // wire (e.g. a clock skew, or an IdP rolled the signing key). Drop
    // the cached token and retry once with a fresh one. The static-key
    // path does not retry because the key is the key.
    if (res.status === 401 && this.auth.kind === "oauth") {
      this.auth.provider.invalidate()
      bearer = await this.acquireBearer()
      res = await this.postChat(url, bearer, body)
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(
        `LLM request failed: ${res.status} ${res.statusText} — ${text.slice(0, 500)}`
      )
    }

    const data = (await res.json()) as ChatCompletionResponse
    const content = data.choices?.[0]?.message?.content
    if (!content) {
      throw new Error(
        `LLM returned no content: ${JSON.stringify(data).slice(0, 500)}`
      )
    }
    return content
  }

  describe(): LLMDescribe {
    if (this.auth.kind === "static") {
      return {
        provider: "openai-compatible",
        baseUrl: this.baseUrl,
        model: this.model,
        authScheme: "Bearer (static API key)",
        authHint: maskSecret(this.auth.apiKey),
        endpointTemplate: "/chat/completions",
      }
    }
    const o = this.auth.provider.describe()
    const parts: string[] = [`client_id=${o.clientIdHint}`, `secret=${o.secretHint}`]
    if (o.scope) parts.push(`scope=${o.scope}`)
    if (o.audience) parts.push(`audience=${o.audience}`)
    return {
      provider: "openai-compatible",
      baseUrl: this.baseUrl,
      model: this.model,
      authScheme: `Bearer (OAuth 2.0 client_credentials @ ${o.tokenUrl})`,
      authHint: parts.join("; "),
      endpointTemplate: "/chat/completions",
    }
  }

  async probe(): Promise<ProbeTrace> {
    if (this.auth.kind === "oauth") {
      return this.probeWithOAuth(this.auth.provider)
    }
    return this.probeStatic(this.auth.apiKey)
  }

  private async acquireBearer(): Promise<string> {
    if (this.auth.kind === "static") return this.auth.apiKey
    return this.auth.provider.getToken()
  }

  private postChat(url: string, bearer: string, body: string): Promise<Response> {
    return fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      body,
    })
  }

  private probeStatic(apiKey: string): Promise<ProbeTrace> {
    return runHttpProbe({
      method: "POST",
      url: `${this.baseUrl}/chat/completions`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: "user", content: "Hi" }],
      }),
      providerLabel: "LLM gateway",
    })
  }

  // Two-phase probe for OAuth mode. Phase 1 talks to the IdP token
  // endpoint directly so a verbose trace can show whether the
  // credentials, the scope/audience or the IdP itself is at fault.
  // Phase 2 calls the gateway with the freshly-minted bearer, so a
  // gateway-side failure (role binding, ACL, model not available)
  // shows up against the chat completions endpoint specifically.
  private async probeWithOAuth(
    provider: OAuthTokenProvider
  ): Promise<ProbeTrace> {
    const t0 = Date.now()
    const tokenPhase = await this.probeTokenEndpoint(provider)
    if (!tokenPhase.ok) {
      return { ok: false, totalMs: Date.now() - t0, steps: tokenPhase.steps }
    }
    let bearer: string
    try {
      bearer = await provider.getToken()
    } catch (err) {
      tokenPhase.steps.push({
        step: "classify",
        ok: false,
        category: "unknown",
        hint: `Token acquired but unavailable for the gateway call: ${
          err instanceof Error ? err.message : String(err)
        }`,
        phase: "Token",
      })
      return { ok: false, totalMs: Date.now() - t0, steps: tokenPhase.steps }
    }
    const gateway = await runHttpProbe({
      method: "POST",
      url: `${this.baseUrl}/chat/completions`,
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: "user", content: "Hi" }],
      }),
      providerLabel: "LLM gateway",
    })
    const gatewaySteps = gateway.steps.map((s) => ({ ...s, phase: "Gateway" }))
    return {
      ok: gateway.ok,
      totalMs: Date.now() - t0,
      steps: [...tokenPhase.steps, ...gatewaySteps],
    }
  }

  // Custom probe for the token endpoint. We do not delegate to
  // runHttpProbe because the request body carries client_secret and
  // the response body carries access_token — both must be kept out of
  // the trace. We log the URL, method and Content-Type only on the
  // request side and run the response body through redactBearerInJson
  // before truncating.
  private async probeTokenEndpoint(
    provider: OAuthTokenProvider
  ): Promise<{ ok: boolean; steps: ProbeStep[] }> {
    const steps: ProbeStep[] = []
    const tokenUrl = provider.config.tokenUrl

    let host: string
    try {
      host = new URL(tokenUrl).hostname
    } catch {
      steps.push({
        step: "dns",
        ok: false,
        detail: `Invalid token URL: ${tokenUrl}`,
        phase: "Token",
      })
      steps.push({
        step: "classify",
        ok: false,
        category: "dns",
        hint: "The OAuth token URL could not be parsed.",
        phase: "Token",
      })
      return { ok: false, steps }
    }

    const dnsStart = Date.now()
    try {
      const { address } = await dns.lookup(host)
      steps.push({
        step: "dns",
        ok: true,
        ms: Date.now() - dnsStart,
        address,
        detail: `${host} → ${address}`,
        phase: "Token",
      })
    } catch (err) {
      steps.push({
        step: "dns",
        ok: false,
        ms: Date.now() - dnsStart,
        detail: err instanceof Error ? err.message : String(err),
        phase: "Token",
      })
      steps.push({
        step: "classify",
        ok: false,
        category: "dns",
        hint: hintFor("dns", "OAuth token endpoint"),
        phase: "Token",
      })
      return { ok: false, steps }
    }

    steps.push({
      step: "request",
      ok: true,
      method: "POST",
      url: tokenUrl,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      phase: "Token",
    })

    const reqStart = Date.now()
    let res: Response
    try {
      res = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: provider.formBody(),
      })
    } catch (err) {
      const detail = describeFetchFailure(err)
      const category = classifyFetchFailure(err)
      steps.push({
        step: "response",
        ok: false,
        ms: Date.now() - reqStart,
        detail,
        phase: "Token",
      })
      steps.push({
        step: "classify",
        ok: false,
        category,
        hint: hintFor(category, "OAuth token endpoint"),
        phase: "Token",
      })
      return { ok: false, steps }
    }

    const bodyText = await res.text().catch(() => "")
    const safeBody = redactBearerInJson(bodyText).slice(0, 600)
    steps.push({
      step: "response",
      ok: res.ok,
      ms: Date.now() - reqStart,
      status: res.status,
      statusText: res.statusText,
      bodyExcerpt: safeBody,
      phase: "Token",
    })

    if (!res.ok) {
      const category = classifyHttpStatus(res.status)
      const baseHint = hintFor(category, "OAuth token endpoint")
      const extra =
        " For OAuth: check the client_id, client_secret, and scope/audience values, and that the IdP allows the client_credentials grant for this client."
      steps.push({
        step: "classify",
        ok: false,
        category,
        hint: baseHint + extra,
        phase: "Token",
      })
      return { ok: false, steps }
    }

    let parsed: { access_token?: string; expires_in?: number; expires_on?: number }
    try {
      parsed = JSON.parse(bodyText)
    } catch {
      steps.push({
        step: "classify",
        ok: false,
        category: "parse",
        hint: "Token endpoint returned 200 but the body was not valid JSON.",
        phase: "Token",
      })
      return { ok: false, steps }
    }
    if (typeof parsed.access_token !== "string" || !parsed.access_token) {
      steps.push({
        step: "classify",
        ok: false,
        category: "parse",
        hint: "Token endpoint returned 200 but no access_token field was present.",
        phase: "Token",
      })
      return { ok: false, steps }
    }
    // Cache for the gateway probe and any subsequent real LLM calls.
    provider.acceptResponse(parsed)
    return { ok: true, steps }
  }
}
