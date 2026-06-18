// Provider-agnostic Git interface used to back the data repo.
//
// All file paths are relative to the repo root (no leading slash). All
// content is treated as UTF-8 text — arch-tool stores YAML, JSON and
// drawio XML; binary files are out of scope.
//
// `sha` is an opaque provider-specific revision token returned from getFile
// and required for subsequent putFile/deleteFile so the provider can detect
// concurrent edits. On GitHub it is the file blob sha; on Azure DevOps it
// is the branch HEAD commit OID at read time. Callers must not interpret
// it — they store it and pass it back.

import type { ProbeTrace } from "../diagnostics"

export interface GitFile {
  path: string
  content: string
  sha: string
}

export interface GitTreeEntry {
  path: string
  sha: string // opaque blob id, suitable for getBlob
  type: "blob"
}

export interface GitCommitMeta {
  sha: string
  message: string
  author: string
  date: string
}

export interface GitDescribe {
  provider: "github" | "ado" | "filesystem"
  baseUrl: string
  branch: string
  // For GitHub: "owner/repo". For ADO: "project/repo". For filesystem:
  // the resolved root path.
  repoIdentifier: string
  authScheme: string
  authHint: string
}

export interface GitProvider {
  readonly name: string
  readonly branch: string

  // List all blobs whose path starts with `prefix` (recursive). Returns []
  // when the repo or branch is empty; throws on other failures.
  listTree(prefix: string): Promise<GitTreeEntry[]>

  // Read a file's content + revision token. Throws GitNotFoundError when
  // the file does not exist on the configured branch.
  getFile(path: string): Promise<GitFile>

  // Fetch a blob by its opaque id (typically obtained from listTree).
  getBlob(sha: string): Promise<string>

  // Create (no sha) or update (sha required) a file with one commit.
  putFile(path: string, content: string, message: string, sha?: string): Promise<void>

  // Delete an existing file with one commit. sha is required.
  deleteFile(path: string, sha: string, message: string): Promise<void>

  // List commits touching a specific path, newest first.
  listFileHistory(path: string, limit: number): Promise<GitCommitMeta[]>

  // Sanitized self-description for the Settings UI. Sync, no network.
  describe(): GitDescribe

  // Verbose four-step probe (DNS / request / response / classify).
  probe(): Promise<ProbeTrace>
}

export class GitNotFoundError extends Error {
  readonly status = 404
  constructor(message: string) {
    super(message)
    this.name = "GitNotFoundError"
  }
}
