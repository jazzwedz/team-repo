// Data Model Registry factory.
//
// Reads env vars and decides whether the integration is configured. The
// integration is opt-in — when DATA_MODEL_REGISTRY_BASE_URL is unset,
// `isDataModelConfigured()` returns false and the form / detail UI
// degrades by hiding the Data model card entirely.

import { DataModelRestProvider } from "./rest"
import type { DataModelProvider } from "./types"

export type {
  DataModelProvider,
  DataModelDescribe,
  EntityAttribute,
  EntityRelationship,
  EntityVersion,
} from "./types"

const DEFAULT_ENTITY_PATH = "/dataModel/version"
const DEFAULT_RELATIONSHIPS_PATH = "/relationships"
const DEFAULT_ZONE = "PRD"

let _provider: DataModelProvider | null = null

export function isDataModelConfigured(): boolean {
  if (!process.env.DATA_MODEL_REGISTRY_BASE_URL) return false
  const authMode = (process.env.DATA_MODEL_REGISTRY_AUTH || "bearer").toLowerCase()
  if (authMode === "oauth") {
    return !!(
      process.env.DATA_MODEL_REGISTRY_OAUTH_TOKEN_URL &&
      process.env.DATA_MODEL_REGISTRY_OAUTH_CLIENT_ID &&
      process.env.DATA_MODEL_REGISTRY_OAUTH_CLIENT_SECRET
    )
  }
  return !!process.env.DATA_MODEL_REGISTRY_TOKEN
}

export const DATA_MODEL_DISABLED_MESSAGE =
  "Data model registry is not configured. Set DATA_MODEL_REGISTRY_BASE_URL and either DATA_MODEL_REGISTRY_TOKEN (for static bearer auth) or DATA_MODEL_REGISTRY_OAUTH_TOKEN_URL + DATA_MODEL_REGISTRY_OAUTH_CLIENT_ID + DATA_MODEL_REGISTRY_OAUTH_CLIENT_SECRET (for OAuth 2.0)."

export function missingDataModelEnvVars(): string[] {
  const missing: string[] = []
  if (!process.env.DATA_MODEL_REGISTRY_BASE_URL)
    missing.push("DATA_MODEL_REGISTRY_BASE_URL")
  const authMode = (process.env.DATA_MODEL_REGISTRY_AUTH || "bearer").toLowerCase()
  if (authMode === "oauth") {
    if (!process.env.DATA_MODEL_REGISTRY_OAUTH_TOKEN_URL)
      missing.push("DATA_MODEL_REGISTRY_OAUTH_TOKEN_URL")
    if (!process.env.DATA_MODEL_REGISTRY_OAUTH_CLIENT_ID)
      missing.push("DATA_MODEL_REGISTRY_OAUTH_CLIENT_ID")
    if (!process.env.DATA_MODEL_REGISTRY_OAUTH_CLIENT_SECRET)
      missing.push("DATA_MODEL_REGISTRY_OAUTH_CLIENT_SECRET")
  } else if (!process.env.DATA_MODEL_REGISTRY_TOKEN) {
    missing.push(
      "DATA_MODEL_REGISTRY_TOKEN (or DATA_MODEL_REGISTRY_AUTH=oauth + OAuth vars)"
    )
  }
  return missing
}

export function getDataModel(): DataModelProvider {
  if (_provider) return _provider

  const baseUrl = process.env.DATA_MODEL_REGISTRY_BASE_URL
  if (!baseUrl) {
    throw new Error(DATA_MODEL_DISABLED_MESSAGE)
  }
  const apiPath = process.env.DATA_MODEL_REGISTRY_API_PATH || ""
  const zone = process.env.DATA_MODEL_REGISTRY_ZONE || DEFAULT_ZONE
  const entityEndpoint =
    process.env.DATA_MODEL_REGISTRY_ENTITY_PATH || DEFAULT_ENTITY_PATH
  const relationshipsEndpoint =
    process.env.DATA_MODEL_REGISTRY_RELATIONSHIPS_PATH ||
    DEFAULT_RELATIONSHIPS_PATH

  const authMode = (process.env.DATA_MODEL_REGISTRY_AUTH || "bearer").toLowerCase()
  if (authMode === "oauth") {
    const tokenUrl = process.env.DATA_MODEL_REGISTRY_OAUTH_TOKEN_URL
    const clientId = process.env.DATA_MODEL_REGISTRY_OAUTH_CLIENT_ID
    const clientSecret = process.env.DATA_MODEL_REGISTRY_OAUTH_CLIENT_SECRET
    if (!tokenUrl || !clientId || !clientSecret) {
      throw new Error(DATA_MODEL_DISABLED_MESSAGE)
    }
    _provider = new DataModelRestProvider({
      baseUrl,
      apiPath,
      zone,
      entityEndpoint,
      relationshipsEndpoint,
      auth: {
        kind: "oauth",
        oauth: {
          tokenUrl,
          clientId,
          clientSecret,
          scope: process.env.DATA_MODEL_REGISTRY_OAUTH_SCOPE || undefined,
          audience: process.env.DATA_MODEL_REGISTRY_OAUTH_AUDIENCE || undefined,
        },
      },
    })
    return _provider
  }

  const token = process.env.DATA_MODEL_REGISTRY_TOKEN
  if (!token) {
    throw new Error(DATA_MODEL_DISABLED_MESSAGE)
  }
  _provider = new DataModelRestProvider({
    baseUrl,
    apiPath,
    zone,
    entityEndpoint,
    relationshipsEndpoint,
    auth: { kind: "static", token },
  })
  return _provider
}

export function resetDataModelProvider(): void {
  _provider = null
}
