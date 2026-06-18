// OAuth 2.0 client_credentials grant (RFC 6749, section 4.4).
//
// Works with any standards-compliant identity provider that exposes a
// token endpoint accepting `grant_type=client_credentials` with a
// client_id + client_secret to mint a short-lived bearer token for an
// API resource. The token URL is explicit so the adapter is vendor-
// agnostic — Microsoft Entra ID, Okta, Auth0, Keycloak, AWS Cognito and
// self-hosted IdPs all expose a token endpoint that fits.
//
// The provider caches one access token in memory and refreshes
// proactively 5 minutes before the IdP-declared expiry. Concurrent
// callers share a single in-flight refresh so a burst of LLM calls
// triggers exactly one round-trip to the IdP.

import { maskSecret } from "../diagnostics"

export interface OAuthClientCredentialsConfig {
  tokenUrl: string
  clientId: string
  clientSecret: string
  // Optional — most IdPs require a scope, some accept an audience
  // instead, a few want both. Set whatever your IdP expects.
  scope?: string
  audience?: string
}

export interface OAuthTokenDescribe {
  tokenUrl: string
  clientId: string
  clientIdHint: string
  scope?: string
  audience?: string
  secretHint: string
}

interface TokenResponse {
  access_token?: string
  token_type?: string
  expires_in?: number
  expires_on?: number // some IdPs return an absolute epoch (seconds)
}

interface CachedToken {
  accessToken: string
  expiresAt: number
}

const REFRESH_BUFFER_MS = 5 * 60 * 1000
const DEFAULT_TTL_S = 3600

export class OAuthTokenProvider {
  readonly config: OAuthClientCredentialsConfig
  private cache: CachedToken | null = null
  private inflight: Promise<string> | null = null

  constructor(config: OAuthClientCredentialsConfig) {
    this.config = config
  }

  // Returns a fresh-enough access token, fetching one if the cache is
  // empty or close to expiry. Concurrent callers share one in-flight
  // request. Pass `bypassCache: true` from diagnostics so a health
  // probe always verifies live credentials instead of returning a
  // cached "ok".
  async getToken(opts?: { bypassCache?: boolean }): Promise<string> {
    if (!opts?.bypassCache) {
      const cached = this.cache
      if (cached && cached.expiresAt - Date.now() > REFRESH_BUFFER_MS) {
        return cached.accessToken
      }
      if (this.inflight) return this.inflight
    }
    const p = this.fetchToken()
    if (!opts?.bypassCache) this.inflight = p
    try {
      return await p
    } finally {
      this.inflight = null
    }
  }

  // Build the application/x-www-form-urlencoded body the token
  // endpoint expects. Exposed so the diagnostics probe can re-use the
  // exact same encoding when it talks to the IdP directly.
  formBody(): string {
    const params = new URLSearchParams()
    params.set("grant_type", "client_credentials")
    params.set("client_id", this.config.clientId)
    params.set("client_secret", this.config.clientSecret)
    if (this.config.scope) params.set("scope", this.config.scope)
    if (this.config.audience) params.set("audience", this.config.audience)
    return params.toString()
  }

  // Populate the cache from an already-parsed token response. The
  // diagnostics probe calls this after talking to the IdP itself, so
  // the immediately-following gateway probe reuses that token rather
  // than fetching a second one.
  acceptResponse(data: TokenResponse): void {
    if (typeof data.access_token !== "string" || !data.access_token) return
    let expiresAt: number
    if (typeof data.expires_in === "number") {
      expiresAt = Date.now() + data.expires_in * 1000
    } else if (typeof data.expires_on === "number") {
      expiresAt = data.expires_on * 1000
    } else {
      expiresAt = Date.now() + DEFAULT_TTL_S * 1000
    }
    this.cache = { accessToken: data.access_token, expiresAt }
  }

  invalidate(): void {
    this.cache = null
  }

  describe(): OAuthTokenDescribe {
    return {
      tokenUrl: this.config.tokenUrl,
      clientId: this.config.clientId,
      clientIdHint: maskSecret(this.config.clientId),
      scope: this.config.scope,
      audience: this.config.audience,
      secretHint: maskSecret(this.config.clientSecret),
    }
  }

  private async fetchToken(): Promise<string> {
    const res = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: this.formBody(),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(
        `OAuth token endpoint returned ${res.status} ${res.statusText}: ${text.slice(0, 300)}`
      )
    }
    let data: TokenResponse
    try {
      data = (await res.json()) as TokenResponse
    } catch {
      throw new Error("OAuth token endpoint returned a non-JSON body.")
    }
    if (typeof data.access_token !== "string" || !data.access_token) {
      throw new Error("OAuth token response had no access_token field.")
    }
    this.acceptResponse(data)
    return data.access_token
  }
}
