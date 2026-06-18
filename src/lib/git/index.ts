// Git provider factory — selects a backend based on the GIT_PROVIDER env var.
//
//   GIT_PROVIDER=github      → GitHubProvider (default)
//   GIT_PROVIDER=ado         → ADOProvider (also accepts "azure-devops")
//   GIT_PROVIDER=filesystem  → FilesystemProvider (also accepts "fs", "file")
//
// The provider holds connection details (URL, credentials, branch, root
// path) at construction time. Switch by editing env vars and restarting
// the app.

import { GitHubProvider } from "./github"
import { ADOProvider } from "./ado"
import { FilesystemProvider } from "./filesystem"
import type { GitProvider } from "./types"

export type {
  GitProvider,
  GitFile,
  GitTreeEntry,
  GitCommitMeta,
  GitDescribe,
} from "./types"
export { GitNotFoundError } from "./types"

export type GitProviderName = "github" | "ado" | "filesystem"

let _provider: GitProvider | null = null

export function getGitProviderName(): GitProviderName {
  const raw = (process.env.GIT_PROVIDER || "github").toLowerCase().trim()
  if (raw === "ado" || raw === "azure-devops" || raw === "azuredevops") return "ado"
  if (raw === "filesystem" || raw === "fs" || raw === "file") return "filesystem"
  return "github"
}

export function isGitConfigured(): boolean {
  const name = getGitProviderName()
  if (name === "github") {
    return !!(process.env.GITHUB_TOKEN && process.env.GITHUB_OWNER)
  }
  if (name === "ado") {
    return !!(
      process.env.ADO_BASE_URL &&
      process.env.ADO_PROJECT &&
      process.env.ADO_REPO &&
      process.env.ADO_PAT
    )
  }
  // filesystem
  return !!process.env.FS_STORAGE_PATH
}

export function getGit(): GitProvider {
  if (_provider) return _provider
  const name = getGitProviderName()

  if (name === "github") {
    const token = process.env.GITHUB_TOKEN
    const owner = process.env.GITHUB_OWNER
    if (!token || !owner) {
      throw new Error(
        "GitHub provider not configured (set GITHUB_TOKEN and GITHUB_OWNER)."
      )
    }
    _provider = new GitHubProvider({
      token,
      owner,
      repo: process.env.GITHUB_REPO || "arch-data",
      branch: process.env.GITHUB_BRANCH || "main",
    })
    return _provider
  }

  if (name === "ado") {
    const baseUrl = process.env.ADO_BASE_URL
    const project = process.env.ADO_PROJECT
    const repo = process.env.ADO_REPO
    const pat = process.env.ADO_PAT
    if (!baseUrl || !project || !repo || !pat) {
      throw new Error(
        "Azure DevOps provider not configured (set ADO_BASE_URL, ADO_PROJECT, ADO_REPO, ADO_PAT)."
      )
    }
    _provider = new ADOProvider({
      baseUrl,
      project,
      repo,
      branch: process.env.ADO_BRANCH || "main",
      pat,
    })
    return _provider
  }

  // filesystem
  const rootPath = process.env.FS_STORAGE_PATH
  if (!rootPath) {
    throw new Error(
      "Filesystem provider not configured (set FS_STORAGE_PATH to an absolute directory path)."
    )
  }
  _provider = new FilesystemProvider({ rootPath })
  return _provider
}

export function resetGitProvider(): void {
  _provider = null
}

// Env-var names that should be set for the active provider but aren't.
// Returns [] when configured.
export function missingGitEnvVars(): string[] {
  const name = getGitProviderName()
  if (name === "github") {
    const missing: string[] = []
    if (!process.env.GITHUB_TOKEN) missing.push("GITHUB_TOKEN")
    if (!process.env.GITHUB_OWNER) missing.push("GITHUB_OWNER")
    return missing
  }
  if (name === "ado") {
    const missing: string[] = []
    if (!process.env.ADO_BASE_URL) missing.push("ADO_BASE_URL")
    if (!process.env.ADO_PROJECT) missing.push("ADO_PROJECT")
    if (!process.env.ADO_REPO) missing.push("ADO_REPO")
    if (!process.env.ADO_PAT) missing.push("ADO_PAT")
    return missing
  }
  // filesystem
  return process.env.FS_STORAGE_PATH ? [] : ["FS_STORAGE_PATH"]
}
