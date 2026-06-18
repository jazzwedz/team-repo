// Azure DevOps Code Search client (read-only).
//
// Separate from the git item API (source-git.ts / ADOProvider): Code
// Search is a different service. On ADO Services it lives on the
// `almsearch.dev.azure.com` host (the git API is on `dev.azure.com`); on
// ADO Server it shares the collection host. We derive the search host
// from SRC_ADO_BASE_URL, with an optional SRC_ADO_SEARCH_URL override.
//
// For now this powers a health-check probe in Settings; the source mapper
// will later use codeSearch() to find content-based candidate files.

import { isSourceCodeConfigured, missingSourceEnvVars } from "./source-git"

const API_VERSION = "7.1"

/** Derive the Code Search API base URL, or null when unconfigured. */
export function searchBaseUrl(): string | null {
  const override = process.env.SRC_ADO_SEARCH_URL?.replace(/\/$/, "")
  if (override) return override
  const base = process.env.SRC_ADO_BASE_URL?.replace(/\/$/, "")
  if (!base) return null
  // ADO Services: Code Search runs on almsearch.dev.azure.com.
  // ADO Server (on-prem): same host as the collection.
  return base.includes("dev.azure.com")
    ? base.replace("dev.azure.com", "almsearch.dev.azure.com")
    : base
}

export interface CodeSearchHit {
  path: string
  repository?: string
  /** Number of matching lines in this file, when reported. */
  matchCount?: number
}

export interface CodeSearchResult {
  ok: boolean
  status: number
  count: number
  hits: CodeSearchHit[]
  error?: string
}

/**
 * Query ADO Code Search, scoped to the configured repo + branch (and an
 * optional set of path prefixes). Returns the matching files. Read-only.
 */
export async function codeSearch(
  searchText: string,
  opts: { top?: number; paths?: string[] } = {}
): Promise<CodeSearchResult> {
  const base = searchBaseUrl()
  const project = process.env.SRC_ADO_PROJECT
  const repo = process.env.SRC_ADO_REPO
  const branch = process.env.SRC_ADO_BRANCH || "main"
  const pat = process.env.SRC_ADO_PAT
  if (!base || !project || !repo || !pat) {
    throw new Error("Code Search not configured (SRC_ADO_* missing).")
  }

  const url = `${base}/${encodeURIComponent(project)}/_apis/search/codesearchresults?api-version=${API_VERSION}`
  const body = {
    searchText,
    $top: opts.top ?? 50,
    filters: {
      // ADO Code Search requires the Project filter whenever a Repository
      // filter is set, else it 400s with InvalidQueryException.
      Project: [project],
      Repository: [repo],
      Branch: [branch],
      ...(opts.paths && opts.paths.length ? { Path: opts.paths } : {}),
    },
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      count: 0,
      hits: [],
      error: `Code Search API returned ${res.status} ${(await res.text()).slice(0, 200)}`,
    }
  }

  const data = (await res.json()) as {
    count?: number
    results?: Array<{ path?: string; repository?: { name?: string }; matches?: unknown }>
  }
  const hits: CodeSearchHit[] = (data.results || [])
    .filter((r) => typeof r.path === "string")
    .map((r) => ({ path: r.path!.replace(/^\//, ""), repository: r.repository?.name }))
  return { ok: true, status: res.status, count: data.count ?? hits.length, hits }
}

export interface CodeSearchProbe {
  ok: boolean
  configured: boolean
  missingEnv?: string[]
  provider?: string
  branch?: string
  searchHost?: string
  elapsedMs?: number
  error?: string
}

/** Health-check probe: is the Code Search API reachable & authorized? */
export async function probeCodeSearch(): Promise<CodeSearchProbe> {
  const missing = missingSourceEnvVars()
  if (!isSourceCodeConfigured()) {
    return {
      ok: false,
      configured: false,
      missingEnv: missing,
      error: `Not configured — set: ${missing.join(", ")}.`,
    }
  }
  const searchHost = searchBaseUrl() || undefined
  const branch = process.env.SRC_ADO_BRANCH || "main"
  const started = Date.now()
  try {
    // Any valid query proves reachability + auth; 0 results is still OK.
    const r = await codeSearch("import", { top: 1 })
    const elapsedMs = Date.now() - started
    return {
      ok: r.ok,
      configured: true,
      provider: "ADO Code Search",
      branch,
      searchHost,
      elapsedMs,
      error: r.ok ? undefined : r.error,
    }
  } catch (error) {
    return {
      ok: false,
      configured: true,
      searchHost,
      branch,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
