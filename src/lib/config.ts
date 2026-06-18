// Runtime configuration loaded from `config.yaml` at the root of the
// data repo. Optional — when the file is missing or unreadable, callers
// get an empty object and fall back to env vars or built-in defaults.
//
// This is the single place to put non-secret, team-shared settings that
// should survive across deployments and be editable through the Settings
// page in the future (model name, default audience, etc.). Secrets always
// stay in environment variables.

import yaml from "js-yaml"
import { getGit, isGitConfigured, GitNotFoundError } from "./git"
import type { UIBlocksConfig } from "./ui-blocks"
import { getLogger } from "./log"

export interface RuntimeConfig {
  llm?: {
    model?: string
  }
  ui?: {
    blocks?: UIBlocksConfig
  }
}

const TTL_MS = 60_000
let _cached: { value: RuntimeConfig; loadedAt: number } | null = null

export async function loadConfig(): Promise<RuntimeConfig> {
  const now = Date.now()
  if (_cached && now - _cached.loadedAt < TTL_MS) return _cached.value

  if (!isGitConfigured()) {
    _cached = { value: {}, loadedAt: now }
    return {}
  }

  try {
    const file = await getGit().getFile("config.yaml")
    const parsed = yaml.load(file.content)
    const value: RuntimeConfig =
      parsed && typeof parsed === "object" ? (parsed as RuntimeConfig) : {}
    _cached = { value, loadedAt: now }
    return value
  } catch (error: unknown) {
    if (error instanceof GitNotFoundError) {
      _cached = { value: {}, loadedAt: now }
      return {}
    }
    // Other errors (auth, network) — log once and return empty so AI
    // routes still work with env-default model.
    getLogger().warn("Failed to load config.yaml", {
      err: error instanceof Error ? error.message : String(error),
    })
    _cached = { value: {}, loadedAt: now }
    return {}
  }
}

export function clearConfigCache(): void {
  _cached = null
}
