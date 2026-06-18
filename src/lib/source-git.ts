// Source-code repository connection (read-only).
//
// This is SEPARATE from the catalog data repo (getGit()). The data repo
// holds the YAML catalog; this points at the actual application source
// code in Azure DevOps, so a future consistency check can read code as
// evidence for what the catalog claims. MVP: one ADO repo, its own
// read-only PAT (scope Code:Read), configured via SRC_ADO_* env vars and
// verified by a "Test connection" in Settings.
//
// We reuse the existing ADOProvider — only its read methods (probe,
// listTree, getFile, getBlob, listFileHistory) are ever called here. No
// write path runs against the source repo.

import { ADOProvider } from "./git/ado"

let _provider: ADOProvider | null = null

export function isSourceCodeConfigured(): boolean {
  return !!(
    process.env.SRC_ADO_BASE_URL &&
    process.env.SRC_ADO_PROJECT &&
    process.env.SRC_ADO_REPO &&
    process.env.SRC_ADO_PAT
  )
}

// Env-var names that should be set but aren't. Returns [] when configured.
export function missingSourceEnvVars(): string[] {
  const missing: string[] = []
  if (!process.env.SRC_ADO_BASE_URL) missing.push("SRC_ADO_BASE_URL")
  if (!process.env.SRC_ADO_PROJECT) missing.push("SRC_ADO_PROJECT")
  if (!process.env.SRC_ADO_REPO) missing.push("SRC_ADO_REPO")
  if (!process.env.SRC_ADO_PAT) missing.push("SRC_ADO_PAT")
  return missing
}

export function getSourceGit(): ADOProvider {
  if (_provider) return _provider
  const baseUrl = process.env.SRC_ADO_BASE_URL
  const project = process.env.SRC_ADO_PROJECT
  const repo = process.env.SRC_ADO_REPO
  const pat = process.env.SRC_ADO_PAT
  if (!baseUrl || !project || !repo || !pat) {
    throw new Error(
      "Source code (Azure DevOps) not configured (set SRC_ADO_BASE_URL, SRC_ADO_PROJECT, SRC_ADO_REPO, SRC_ADO_PAT)."
    )
  }
  _provider = new ADOProvider({
    baseUrl,
    project,
    repo,
    branch: process.env.SRC_ADO_BRANCH || "main",
    pat,
  })
  return _provider
}

// Tests / hot config swap.
export function resetSourceGit(): void {
  _provider = null
}
