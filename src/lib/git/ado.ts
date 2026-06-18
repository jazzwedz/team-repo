// Azure DevOps Git adapter (Service + on-prem Server/TFS).
//
// Auth: Personal Access Token via Basic auth (`Basic base64(":{PAT}")`).
// API version: 7.1.
//
// Concurrency model: ADO does not have per-file blob SHAs the way GitHub
// does — pushes update the whole branch ref. So the opaque `sha` returned
// from getFile is the branch HEAD commit OID at read time. On putFile /
// deleteFile we send it as `refUpdates[0].oldObjectId`; if the branch has
// advanced for any reason, the push returns 409 (concurrent edit).
//
// Base URL accepts both forms:
//   ADO Service: https://dev.azure.com/{org}
//   ADO Server:  https://your-server/{collection}
// The provider appends `/{project}/_apis/git/repositories/{repo}`.

import type {
  GitProvider,
  GitFile,
  GitTreeEntry,
  GitCommitMeta,
  GitDescribe,
} from "./types"
import { GitNotFoundError } from "./types"
import { maskSecret, runHttpProbe, type ProbeTrace } from "../diagnostics"

const API_VERSION = "7.1"

interface AdoChange {
  changeType: "add" | "edit" | "delete"
  item: { path: string }
  newContent?: { content: string; contentType: "base64encoded" }
}

export class ADOProvider implements GitProvider {
  readonly name = "ado" as const
  readonly branch: string
  private repoBaseUrl: string
  private baseUrl: string
  private project: string
  private repo: string
  private pat: string
  private authHeader: string
  private branchHeadCache: { id: string; fetchedAt: number } | null = null

  constructor(opts: {
    baseUrl: string
    project: string
    repo: string
    branch: string
    pat: string
  }) {
    const base = opts.baseUrl.replace(/\/$/, "")
    this.baseUrl = base
    this.project = opts.project
    this.repo = opts.repo
    this.repoBaseUrl = `${base}/${encodeURIComponent(opts.project)}/_apis/git/repositories/${encodeURIComponent(opts.repo)}`
    this.branch = opts.branch
    this.pat = opts.pat
    this.authHeader = `Basic ${Buffer.from(`:${opts.pat}`).toString("base64")}`
  }

  async listTree(prefix: string): Promise<GitTreeEntry[]> {
    const scope = "/" + prefix.replace(/^\//, "").replace(/\/$/, "")
    const url =
      `${this.repoBaseUrl}/items` +
      `?scopePath=${encodeURIComponent(scope)}` +
      `&recursionLevel=Full` +
      `&versionDescriptor.version=${encodeURIComponent(this.branch)}` +
      `&versionDescriptor.versionType=branch` +
      `&api-version=${API_VERSION}`
    const res = await this.request(url)
    if (res.status === 404) return []
    if (!res.ok) {
      throw new Error(
        `ADO listTree failed: ${res.status} ${(await res.text()).slice(0, 300)}`
      )
    }
    const data = (await res.json()) as {
      value?: Array<{
        path?: string
        objectId?: string
        gitObjectType?: string
        isFolder?: boolean
      }>
    }
    return (data.value || [])
      .filter(
        (e) =>
          e.gitObjectType === "blob" &&
          !e.isFolder &&
          typeof e.path === "string" &&
          typeof e.objectId === "string"
      )
      .map((e) => ({
        path: e.path!.replace(/^\//, ""),
        sha: e.objectId!,
        type: "blob" as const,
      }))
  }

  async getFile(path: string): Promise<GitFile> {
    const apiPath = "/" + path.replace(/^\//, "")
    const url =
      `${this.repoBaseUrl}/items` +
      `?path=${encodeURIComponent(apiPath)}` +
      `&includeContent=true` +
      `&versionDescriptor.version=${encodeURIComponent(this.branch)}` +
      `&versionDescriptor.versionType=branch` +
      `&api-version=${API_VERSION}`
    const res = await this.request(url)
    if (res.status === 404) {
      throw new GitNotFoundError(`File not found: ${path}`)
    }
    if (!res.ok) {
      throw new Error(
        `ADO getFile failed: ${res.status} ${(await res.text()).slice(0, 300)}`
      )
    }
    const data = (await res.json()) as { content?: string }
    if (typeof data.content !== "string") {
      throw new GitNotFoundError(`File has no content: ${path}`)
    }
    const sha = await this.getBranchHead()
    return { path, content: data.content, sha }
  }

  async getBlob(sha: string): Promise<string> {
    const url =
      `${this.repoBaseUrl}/blobs/${encodeURIComponent(sha)}` +
      `?api-version=${API_VERSION}` +
      `&%24format=text`
    const res = await this.request(url, {
      headers: { Accept: "text/plain" },
    })
    if (res.status === 404) {
      throw new GitNotFoundError(`Blob not found: ${sha}`)
    }
    if (!res.ok) {
      throw new Error(
        `ADO getBlob failed: ${res.status} ${(await res.text()).slice(0, 300)}`
      )
    }
    return await res.text()
  }

  async putFile(
    path: string,
    content: string,
    message: string,
    sha?: string
  ): Promise<void> {
    const oldObjectId = sha || (await this.getBranchHead(true))
    const changeType = sha ? "edit" : "add"
    await this.push(oldObjectId, message, [
      {
        changeType,
        item: { path: "/" + path.replace(/^\//, "") },
        newContent: {
          content: Buffer.from(content).toString("base64"),
          contentType: "base64encoded",
        },
      },
    ])
    this.branchHeadCache = null
  }

  async deleteFile(path: string, sha: string, message: string): Promise<void> {
    await this.push(sha, message, [
      {
        changeType: "delete",
        item: { path: "/" + path.replace(/^\//, "") },
      },
    ])
    this.branchHeadCache = null
  }

  async listFileHistory(path: string, limit: number): Promise<GitCommitMeta[]> {
    const itemPath = "/" + path.replace(/^\//, "")
    const url =
      `${this.repoBaseUrl}/commits` +
      `?searchCriteria.itemPath=${encodeURIComponent(itemPath)}` +
      `&searchCriteria.itemVersion.version=${encodeURIComponent(this.branch)}` +
      `&searchCriteria.itemVersion.versionType=branch` +
      `&searchCriteria.%24top=${limit}` +
      `&api-version=${API_VERSION}`
    const res = await this.request(url)
    if (!res.ok) {
      throw new Error(
        `ADO listFileHistory failed: ${res.status} ${(await res.text()).slice(0, 300)}`
      )
    }
    const data = (await res.json()) as {
      value?: Array<{
        commitId?: string
        comment?: string
        author?: { name?: string; date?: string }
      }>
    }
    return (data.value || []).map((c) => ({
      sha: (c.commitId || "").slice(0, 7),
      message: c.comment || "",
      author: c.author?.name || "unknown",
      date: c.author?.date || "",
    }))
  }

  describe(): GitDescribe {
    return {
      provider: "ado",
      baseUrl: this.baseUrl,
      branch: this.branch,
      repoIdentifier: `${this.project}/${this.repo}`,
      authScheme: "Basic (:PAT)",
      authHint: maskSecret(this.pat),
    }
  }

  async probe(): Promise<ProbeTrace> {
    // Single ref lookup verifies auth, org/project/repo path, and branch
    // existence — cheaper and clearer than listing items.
    const url =
      `${this.repoBaseUrl}/refs` +
      `?filter=heads/${encodeURIComponent(this.branch)}` +
      `&api-version=${API_VERSION}`
    return runHttpProbe({
      method: "GET",
      url,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
      },
      providerLabel: "Azure DevOps",
    })
  }

  private async request(url: string, init?: RequestInit): Promise<Response> {
    return fetch(url, {
      ...init,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        ...(init?.headers || {}),
      },
    })
  }

  private async getBranchHead(forceRefresh = false): Promise<string> {
    const now = Date.now()
    if (!forceRefresh && this.branchHeadCache && now - this.branchHeadCache.fetchedAt < 2000) {
      return this.branchHeadCache.id
    }
    const url =
      `${this.repoBaseUrl}/refs` +
      `?filter=heads/${encodeURIComponent(this.branch)}` +
      `&api-version=${API_VERSION}`
    const res = await this.request(url)
    if (res.status === 404) {
      throw new GitNotFoundError(`Branch not found: ${this.branch}`)
    }
    if (!res.ok) {
      throw new Error(
        `ADO getBranchHead failed: ${res.status} ${(await res.text()).slice(0, 300)}`
      )
    }
    const data = (await res.json()) as { value?: Array<{ objectId?: string }> }
    const id = data.value?.[0]?.objectId
    if (!id) {
      throw new GitNotFoundError(`Branch not found: ${this.branch}`)
    }
    this.branchHeadCache = { id, fetchedAt: now }
    return id
  }

  private async push(
    oldObjectId: string,
    message: string,
    changes: AdoChange[]
  ): Promise<void> {
    const url = `${this.repoBaseUrl}/pushes?api-version=${API_VERSION}`
    const body = {
      refUpdates: [{ name: `refs/heads/${this.branch}`, oldObjectId }],
      commits: [{ comment: message, changes }],
    }
    const res = await this.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 500)
      const err = new Error(`ADO push failed: ${res.status} ${text}`) as Error & {
        status?: number
      }
      err.status = res.status
      throw err
    }
  }
}
