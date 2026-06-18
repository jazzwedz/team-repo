// Generic REST adapter for a data model registry.
//
// Calls `{BASE_URL}{API_PATH}{entityEndpoint}?entity={name}&zone={zone}`
// for entity metadata and `{BASE_URL}{API_PATH}{relationshipsEndpoint}
// ?entity={name}` for relationships. Both endpoint paths are
// configurable so the operator can wire any REST metadata service.
//
// Auth is either a static bearer token (DATA_MODEL_REGISTRY_TOKEN) or
// OAuth 2.0 client_credentials reusing the same OAuthTokenProvider
// the LLM gateway adapter uses. Tokens are masked in describe() so a
// diagnostic trace never carries them to the browser.

import type {
  DataModelProvider,
  DataModelDescribe,
  EntityAttribute,
  EntityRelationship,
  EntityVersion,
} from "./types"
import {
  classifyFetchFailure,
  classifyHttpStatus,
  describeFetchFailure,
  hintFor,
  maskSecret,
  runHttpProbe,
  type ProbeStep,
  type ProbeTrace,
} from "../diagnostics"
import {
  OAuthTokenProvider,
  type OAuthClientCredentialsConfig,
} from "../llm/oauth-token"
import { promises as dns } from "node:dns"

type AuthConfig =
  | { kind: "static"; token: string }
  | { kind: "oauth"; provider: OAuthTokenProvider }

export interface DataModelRestOptions {
  baseUrl: string
  apiPath: string
  zone: string
  entityEndpoint: string
  relationshipsEndpoint: string
  auth:
    | { kind: "static"; token: string }
    | { kind: "oauth"; oauth: OAuthClientCredentialsConfig }
}

export class DataModelRestProvider implements DataModelProvider {
  readonly name = "rest" as const
  readonly zone: string
  private baseUrl: string
  private apiPath: string
  private entityEndpoint: string
  private relationshipsEndpoint: string
  private auth: AuthConfig

  constructor(opts: DataModelRestOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "")
    this.apiPath = opts.apiPath || ""
    this.zone = opts.zone
    this.entityEndpoint = opts.entityEndpoint
    this.relationshipsEndpoint = opts.relationshipsEndpoint
    if (opts.auth.kind === "static") {
      this.auth = { kind: "static", token: opts.auth.token }
    } else {
      this.auth = {
        kind: "oauth",
        provider: new OAuthTokenProvider(opts.auth.oauth),
      }
    }
  }

  async getEntity(entityName: string): Promise<EntityVersion | null> {
    const url = this.entityUrl(entityName)
    const res = await this.request(url)
    if (res.status === 404) return null
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(
        `Data model registry getEntity failed: ${res.status} ${res.statusText} — ${text.slice(0, 500)}`
      )
    }
    const data = (await res.json()) as Record<string, unknown>
    return parseEntity(data, entityName)
  }

  async getRelationships(entityName: string): Promise<EntityRelationship[]> {
    const url = this.relationshipsUrl(entityName)
    const res = await this.request(url)
    if (res.status === 404) return []
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(
        `Data model registry getRelationships failed: ${res.status} ${res.statusText} — ${text.slice(0, 500)}`
      )
    }
    const data = (await res.json()) as Record<string, unknown>
    return parseRelationships(data)
  }

  describe(): DataModelDescribe {
    if (this.auth.kind === "static") {
      return {
        baseUrl: this.baseUrl,
        apiPath: this.apiPath,
        zone: this.zone,
        authScheme: "Bearer (static token)",
        authHint: maskSecret(this.auth.token),
        entityEndpoint: this.entityEndpoint,
        relationshipsEndpoint: this.relationshipsEndpoint,
      }
    }
    const o = this.auth.provider.describe()
    return {
      baseUrl: this.baseUrl,
      apiPath: this.apiPath,
      zone: this.zone,
      authScheme: `Bearer (OAuth 2.0 client_credentials @ ${o.tokenUrl})`,
      authHint: `client_id=${o.clientIdHint}; secret=${o.secretHint}${o.scope ? `; scope=${o.scope}` : ""}${o.audience ? `; audience=${o.audience}` : ""}`,
      entityEndpoint: this.entityEndpoint,
      relationshipsEndpoint: this.relationshipsEndpoint,
    }
  }

  async probe(): Promise<ProbeTrace> {
    if (this.auth.kind === "static") {
      return this.probeStatic(this.auth.token)
    }
    return this.probeWithOAuth(this.auth.provider)
  }

  // Pick a probe target the service is likely to answer fast. Use a
  // throw-away entity name so we exercise auth + path + 200/4xx
  // classification without depending on any specific entity existing.
  private probeUrl(): string {
    return this.entityUrl("__arch-tool-healthcheck-nonexistent__")
  }

  private probeStatic(token: string): Promise<ProbeTrace> {
    return runHttpProbe({
      method: "GET",
      url: this.probeUrl(),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      providerLabel: "Data model registry",
    })
  }

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
        hint: `Token acquired but unavailable for the registry call: ${
          err instanceof Error ? err.message : String(err)
        }`,
        phase: "Token",
      })
      return { ok: false, totalMs: Date.now() - t0, steps: tokenPhase.steps }
    }
    const target = await runHttpProbe({
      method: "GET",
      url: this.probeUrl(),
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: "application/json",
      },
      providerLabel: "Data model registry",
    })
    const targetSteps = target.steps.map((s) => ({ ...s, phase: "Registry" }))
    return {
      ok: target.ok,
      totalMs: Date.now() - t0,
      steps: [...tokenPhase.steps, ...targetSteps],
    }
  }

  // Inlined OAuth token-endpoint probe — mirrors the LLM adapter so the
  // diagnostic UX is identical (Phase: Token / Phase: Registry).
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
    steps.push({
      step: "response",
      ok: res.ok,
      ms: Date.now() - reqStart,
      status: res.status,
      statusText: res.statusText,
      bodyExcerpt: bodyText.slice(0, 200), // token bodies stay short here
      phase: "Token",
    })
    if (!res.ok) {
      const category = classifyHttpStatus(res.status)
      steps.push({
        step: "classify",
        ok: false,
        category,
        hint:
          hintFor(category, "OAuth token endpoint") +
          " Check the OAuth client_id, client_secret and scope/audience.",
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
        hint: "Token endpoint returned 200 but no access_token field.",
        phase: "Token",
      })
      return { ok: false, steps }
    }
    provider.acceptResponse(parsed)
    return { ok: true, steps }
  }

  private async request(url: string): Promise<Response> {
    const token =
      this.auth.kind === "static"
        ? this.auth.token
        : await this.auth.provider.getToken()
    return fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    })
  }

  private entityUrl(entityName: string): string {
    const root = `${this.baseUrl}${this.apiPath}`.replace(/\/$/, "")
    const path = this.entityEndpoint.startsWith("/")
      ? this.entityEndpoint
      : `/${this.entityEndpoint}`
    const qs = `?entity=${encodeURIComponent(entityName)}&zone=${encodeURIComponent(this.zone)}`
    return `${root}${path}${qs}`
  }

  private relationshipsUrl(entityName: string): string {
    const root = `${this.baseUrl}${this.apiPath}`.replace(/\/$/, "")
    const path = this.relationshipsEndpoint.startsWith("/")
      ? this.relationshipsEndpoint
      : `/${this.relationshipsEndpoint}`
    const qs = `?entity=${encodeURIComponent(entityName)}`
    return `${root}${path}${qs}`
  }
}

// ----- Response parsers -------------------------------------------------

function parseEntity(
  data: Record<string, unknown>,
  fallbackName: string
): EntityVersion {
  const entity =
    typeof data.entity === "string" ? data.entity : fallbackName
  const attributes: EntityAttribute[] = []
  if (Array.isArray(data.attributes)) {
    for (const raw of data.attributes) {
      if (!raw || typeof raw !== "object") continue
      const r = raw as Record<string, unknown>
      if (typeof r.name !== "string") continue
      attributes.push({
        name: r.name,
        type: typeof r.type === "string" ? r.type : "(unknown)",
        nullable:
          typeof r.nullable === "boolean" ? r.nullable : undefined,
      })
    }
  }
  return {
    entity,
    attributes,
    version: typeof data.version === "string" ? data.version : undefined,
    zone: typeof data.zone === "string" ? data.zone : undefined,
  }
}

function parseRelationships(data: Record<string, unknown>): EntityRelationship[] {
  const out: EntityRelationship[] = []
  // Common shapes: { relationships: [...] } or a bare array
  const arr: unknown =
    Array.isArray(data) ? data : (data as { relationships?: unknown }).relationships
  if (!Array.isArray(arr)) return out
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    if (typeof r.parent !== "string" || typeof r.child !== "string") continue
    out.push({
      parent: r.parent,
      child: r.child,
      type: typeof r.type === "string" ? r.type : undefined,
    })
  }
  return out
}
