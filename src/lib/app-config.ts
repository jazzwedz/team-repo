// Editable application settings — everything that used to live only in
// .env.local, now manageable from Settings → Application Settings.
//
// Design:
//   • Precedence is backwards-compatible: effective = saved_in_UI ?? env.
//     What you already have in .env.local keeps working until you change it
//     in the UI; new installs configure purely through the UI.
//   • Saved values live in a LOCAL, gitignored file (app-config.local.json)
//     next to .env.local — same trust level, NEVER committed to the data repo.
//   • At startup (and after every save) the saved values are overlaid onto
//     process.env, so every existing `process.env.X` reader honours an
//     override with no refactoring.
//   • Secrets are masked on display and follow a "leave blank = keep current"
//     edit model; their raw values are never sent to the browser.
//
// Vault-readiness: persistence is behind a small ConfigBackend seam. Today
// the only backend is the local file. To move secrets into a vault later,
// add a VaultBackend and select it (e.g. via CONFIG_SECRET_BACKEND) for the
// secret keys — non-secret config can stay in the local file regardless.

import fs from "node:fs"
import path from "node:path"

export type FieldType = "text" | "password" | "select"

export interface ConfigField {
  key: string
  label: string
  group: string
  type: FieldType
  secret?: boolean
  options?: string[]
  placeholder?: string
  help?: string
  /** Read in the Edge middleware (auth gate) — cannot be overridden by the
   *  local-file store at runtime, so it stays environment-managed. */
  envOnly?: boolean
}

export const CONFIG_GROUPS = [
  "Git storage backend",
  "LLM gateway",
  "Authentication",
  "Confluence",
  "Application",
  "Source code (Azure DevOps, read-only)",
  "Data model registry",
  "Logging",
] as const

// Full inventory mirroring .env.local.example. Order within a group is the
// display order.
export const CONFIG_FIELDS: ConfigField[] = [
  // --- Git storage backend ---
  { key: "GIT_PROVIDER", group: "Git storage backend", label: "Provider", type: "select", options: ["github", "ado", "filesystem"], help: "Where the catalog YAML is stored. Defaults to github." },
  { key: "GITHUB_TOKEN", group: "Git storage backend", label: "GitHub token", type: "password", secret: true, help: "Fine-grained PAT with Contents: Read and write on the data repo." },
  { key: "GITHUB_OWNER", group: "Git storage backend", label: "GitHub owner", type: "text", help: "User or org that owns the data repo." },
  { key: "GITHUB_REPO", group: "Git storage backend", label: "GitHub repo", type: "text", placeholder: "arch-data" },
  { key: "GITHUB_BRANCH", group: "Git storage backend", label: "GitHub branch", type: "text", placeholder: "main" },
  { key: "ADO_BASE_URL", group: "Git storage backend", label: "ADO base URL", type: "text", placeholder: "https://dev.azure.com/{org}" },
  { key: "ADO_PROJECT", group: "Git storage backend", label: "ADO project", type: "text" },
  { key: "ADO_REPO", group: "Git storage backend", label: "ADO repo", type: "text", placeholder: "arch-data" },
  { key: "ADO_BRANCH", group: "Git storage backend", label: "ADO branch", type: "text", placeholder: "main" },
  { key: "ADO_PAT", group: "Git storage backend", label: "ADO PAT", type: "password", secret: true, help: "Code (Read & Write) on the repo." },
  { key: "FS_STORAGE_PATH", group: "Git storage backend", label: "Filesystem path", type: "text", help: "Absolute path to the catalog directory (filesystem provider)." },
  { key: "USER_HEADER", group: "Git storage backend", label: "User header", type: "text", placeholder: "X-Forwarded-User", help: "Request header carrying the authenticated username (reverse-proxy SSO)." },

  // --- LLM gateway ---
  { key: "LLM_PROVIDER", group: "LLM gateway", label: "Provider", type: "select", options: ["anthropic", "openai-compatible"], help: "Defaults to anthropic." },
  { key: "ANTHROPIC_API_KEY", group: "LLM gateway", label: "Anthropic API key", type: "password", secret: true },
  { key: "ANTHROPIC_MODEL", group: "LLM gateway", label: "Anthropic model", type: "text", placeholder: "claude-sonnet-4-20250514" },
  { key: "LLM_BASE_URL", group: "LLM gateway", label: "Gateway base URL", type: "text", placeholder: "https://your-gateway/v1", help: "openai-compatible gateway; the adapter calls {base}/chat/completions." },
  { key: "LLM_MODEL", group: "LLM gateway", label: "Model", type: "text", placeholder: "gpt-4o" },
  { key: "LLM_API_KEY", group: "LLM gateway", label: "Static API key", type: "password", secret: true, help: "Static bearer mode. Ignored when an OAuth token URL is set." },
  { key: "LLM_OAUTH_TOKEN_URL", group: "LLM gateway", label: "OAuth token URL", type: "text", help: "Setting this switches the gateway to OAuth 2.0 client_credentials." },
  { key: "LLM_OAUTH_CLIENT_ID", group: "LLM gateway", label: "OAuth client id", type: "text" },
  { key: "LLM_OAUTH_CLIENT_SECRET", group: "LLM gateway", label: "OAuth client secret", type: "password", secret: true },
  { key: "LLM_OAUTH_SCOPE", group: "LLM gateway", label: "OAuth scope", type: "text" },
  { key: "LLM_OAUTH_AUDIENCE", group: "LLM gateway", label: "OAuth audience", type: "text" },

  // --- Authentication ---
  { key: "SITE_PASSWORD", group: "Authentication", label: "Site password", type: "password", secret: true, envOnly: true, help: "The shared login password. Read by the Edge auth middleware, so it must be set via the environment — it cannot be overridden here." },

  // --- Confluence ---
  { key: "CONFLUENCE_EDITION", group: "Confluence", label: "Edition", type: "select", options: ["cloud", "datacenter"], help: "Defaults to cloud." },
  { key: "CONFLUENCE_BASE_URL", group: "Confluence", label: "Base URL", type: "text", placeholder: "https://your-org.atlassian.net" },
  { key: "CONFLUENCE_EMAIL", group: "Confluence", label: "Account email (Cloud)", type: "text" },
  { key: "CONFLUENCE_API_TOKEN", group: "Confluence", label: "API token (Cloud)", type: "password", secret: true },
  { key: "CONFLUENCE_SPACE_ID", group: "Confluence", label: "Space ID (Cloud)", type: "text" },
  { key: "CONFLUENCE_SPACE_KEY", group: "Confluence", label: "Space key", type: "text", placeholder: "TR" },
  { key: "CONFLUENCE_PAT", group: "Confluence", label: "PAT (Data Center)", type: "password", secret: true },

  // --- Application ---
  { key: "ARCH_TOOL_PUBLIC_URL", group: "Application", label: "Public URL", type: "text", help: "Public URL of this deployment, embedded as the source link on published Confluence pages. Captured at startup — a change applies on the next restart." },

  // --- Source code (ADO, read-only) ---
  { key: "SRC_ADO_BASE_URL", group: "Source code (Azure DevOps, read-only)", label: "Base URL", type: "text", placeholder: "https://dev.azure.com/{org}" },
  { key: "SRC_ADO_PROJECT", group: "Source code (Azure DevOps, read-only)", label: "Project", type: "text" },
  { key: "SRC_ADO_REPO", group: "Source code (Azure DevOps, read-only)", label: "Repo", type: "text" },
  { key: "SRC_ADO_BRANCH", group: "Source code (Azure DevOps, read-only)", label: "Branch", type: "text", placeholder: "main" },
  { key: "SRC_ADO_PAT", group: "Source code (Azure DevOps, read-only)", label: "PAT (Code: Read)", type: "password", secret: true },

  // --- Data model registry ---
  { key: "DATA_MODEL_REGISTRY_BASE_URL", group: "Data model registry", label: "Base URL", type: "text", help: "Leave empty to disable the integration." },
  { key: "DATA_MODEL_REGISTRY_API_PATH", group: "Data model registry", label: "API path", type: "text", placeholder: "/api/v1/" },
  { key: "DATA_MODEL_REGISTRY_ENTITY_PATH", group: "Data model registry", label: "Entity path", type: "text", placeholder: "/dataModel/version" },
  { key: "DATA_MODEL_REGISTRY_RELATIONSHIPS_PATH", group: "Data model registry", label: "Relationships path", type: "text", placeholder: "/relationships" },
  { key: "DATA_MODEL_REGISTRY_ZONE", group: "Data model registry", label: "Zone", type: "text", placeholder: "PRD" },
  { key: "DATA_MODEL_REGISTRY_AUTH", group: "Data model registry", label: "Auth mode", type: "select", options: ["bearer", "oauth"] },
  { key: "DATA_MODEL_REGISTRY_TOKEN", group: "Data model registry", label: "Bearer token", type: "password", secret: true },
  { key: "DATA_MODEL_REGISTRY_OAUTH_TOKEN_URL", group: "Data model registry", label: "OAuth token URL", type: "text" },
  { key: "DATA_MODEL_REGISTRY_OAUTH_CLIENT_ID", group: "Data model registry", label: "OAuth client id", type: "text" },
  { key: "DATA_MODEL_REGISTRY_OAUTH_CLIENT_SECRET", group: "Data model registry", label: "OAuth client secret", type: "password", secret: true },
  { key: "DATA_MODEL_REGISTRY_OAUTH_SCOPE", group: "Data model registry", label: "OAuth scope", type: "text" },
  { key: "DATA_MODEL_REGISTRY_OAUTH_AUDIENCE", group: "Data model registry", label: "OAuth audience", type: "text" },

  // --- Logging ---
  { key: "LOG_LEVEL", group: "Logging", label: "Log level", type: "select", options: ["debug", "info", "warn", "error"] },
  { key: "LOG_SINK", group: "Logging", label: "Log sink", type: "select", options: ["stdout", "file", "both"] },
  { key: "LOG_PATH", group: "Logging", label: "Log path", type: "text", placeholder: "./logs" },
  { key: "LLM_LOG_FULL", group: "Logging", label: "LLM log fidelity", type: "select", options: ["true", "summary"] },
]

const FIELD_BY_KEY = new Map(CONFIG_FIELDS.map((f) => [f.key, f]))
const MANAGED_KEYS = CONFIG_FIELDS.map((f) => f.key)

// Environment as seen at process start, BEFORE any overlay — captured at
// first import so the UI can distinguish "from .env" vs "saved in UI".
const ORIGINAL_ENV: Record<string, string | undefined> = { ...process.env }

// --------------------------- persistence backend ---------------------------
// Vault seam: swap/augment this for secret keys later.

interface ConfigBackend {
  load(): Record<string, string>
  save(values: Record<string, string>): void
}

const STORE_PATH = path.join(process.cwd(), "app-config.local.json")

const localFileBackend: ConfigBackend = {
  load() {
    try {
      const raw = fs.readFileSync(STORE_PATH, "utf8")
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === "object") {
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string") out[k] = v
        }
        return out
      }
    } catch {
      // no file yet / unreadable → empty overrides
    }
    return {}
  },
  save(values) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(values, null, 2) + "\n", "utf8")
  },
}

function backend(): ConfigBackend {
  // Future: return a vault-backed backend for secret keys when configured.
  return localFileBackend
}

let cache: Record<string, string> | null = null
function readStore(): Record<string, string> {
  if (!cache) cache = backend().load()
  return cache
}
function writeStore(values: Record<string, string>): void {
  cache = values
  backend().save(values)
}

// --------------------------- env overlay ---------------------------

/** Set process.env so that, for every managed key, the saved value wins over
 *  the original env (and a cleared key reverts to the original env). Run at
 *  startup and after each save; idempotent. */
export function applyStoreToEnv(): void {
  const store = readStore()
  for (const key of MANAGED_KEYS) {
    const field = FIELD_BY_KEY.get(key)
    if (field?.envOnly) continue // never override env-only keys (e.g. auth gate)
    const orig = ORIGINAL_ENV[key]
    if (orig === undefined) delete process.env[key]
    else process.env[key] = orig
  }
  for (const [key, val] of Object.entries(store)) {
    const field = FIELD_BY_KEY.get(key)
    if (field?.envOnly) continue
    if (typeof val === "string" && val.length > 0) process.env[key] = val
  }
}

/** Effective value of a managed key: saved override ?? original env. */
export function getSetting(key: string): string | undefined {
  const store = readStore()
  const saved = store[key]
  if (typeof saved === "string" && saved.length > 0) return saved
  return ORIGINAL_ENV[key]
}

// --------------------------- UI shapes ---------------------------

export interface EffectiveField {
  key: string
  group: string
  label: string
  type: FieldType
  secret: boolean
  envOnly: boolean
  options?: string[]
  placeholder?: string
  help?: string
  source: "ui" | "env" | "unset"
  hasValue: boolean
  /** Plain value for non-secret fields; "" for secrets (never sent). */
  value: string
}

export function getEffectiveConfig(): EffectiveField[] {
  const store = readStore()
  return CONFIG_FIELDS.map((f) => {
    const inStore = typeof store[f.key] === "string" && store[f.key].length > 0
    const envVal = ORIGINAL_ENV[f.key]
    const hasValue = inStore || (typeof envVal === "string" && envVal.length > 0)
    const source: EffectiveField["source"] = inStore ? "ui" : hasValue ? "env" : "unset"
    return {
      key: f.key,
      group: f.group,
      label: f.label,
      type: f.type,
      secret: !!f.secret,
      envOnly: !!f.envOnly,
      options: f.options,
      placeholder: f.placeholder,
      help: f.help,
      source,
      hasValue,
      value: f.secret ? "" : (inStore ? store[f.key] : envVal || ""),
    }
  })
}

export interface SaveConfigInput {
  /** key → new value. For secrets, "" means leave unchanged. */
  values?: Record<string, string>
  /** keys to clear (revert to env / unset). */
  clear?: string[]
}

export function saveConfig(input: SaveConfigInput): void {
  const store = { ...readStore() }
  for (const key of input.clear || []) {
    if (FIELD_BY_KEY.has(key)) delete store[key]
  }
  for (const [key, raw] of Object.entries(input.values || {})) {
    const field = FIELD_BY_KEY.get(key)
    if (!field || field.envOnly) continue
    const val = typeof raw === "string" ? raw : ""
    if (val === "") {
      // Secret: blank means keep current → ignore. Non-secret: blank means
      // revert to env → delete the override.
      if (!field.secret) delete store[key]
      continue
    }
    store[key] = val
  }
  writeStore(store)
  applyStoreToEnv()
}
