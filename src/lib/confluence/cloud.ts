// Confluence Cloud adapter — v2 REST API + Basic auth (email + API token).
// Storage format only.

import type {
  ConfluenceProvider,
  ConfluencePageRef,
  ConfluencePageFull,
  ConfluenceDescribe,
  ConfluencePageNode,
} from "./types"
import { ConfluenceHttpError } from "./types"
import { buildPageUrl } from "./url"
import { maskSecret, runHttpProbe, type ProbeTrace } from "../diagnostics"

interface CloudPageResponse {
  id: string
  title: string
  spaceId: string
  parentId?: string
  version: { number: number }
  body?: { storage: { value: string } }
  _links: { webui: string; base?: string }
}

export class ConfluenceCloudProvider implements ConfluenceProvider {
  readonly edition = "cloud" as const
  private baseUrl: string
  private spaceId: string
  private email: string
  private apiToken: string
  private authHeader: string

  constructor(opts: {
    baseUrl: string
    email: string
    apiToken: string
    spaceId: string
  }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "")
    this.spaceId = opts.spaceId
    this.email = opts.email
    this.apiToken = opts.apiToken
    this.authHeader =
      "Basic " +
      Buffer.from(`${opts.email}:${opts.apiToken}`).toString("base64")
  }

  async getPage(pageId: string): Promise<ConfluencePageFull> {
    const data = await this.request<CloudPageResponse>(
      `/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=storage`
    )
    return this.toFull(data)
  }

  async createPage(args: {
    title: string
    storageBody: string
    parentId?: string | null
  }): Promise<ConfluencePageRef> {
    const payload: Record<string, unknown> = {
      spaceId: this.spaceId,
      status: "current",
      title: args.title,
      body: { representation: "storage", value: args.storageBody },
    }
    if (args.parentId) payload.parentId = args.parentId
    const data = await this.request<CloudPageResponse>(`/wiki/api/v2/pages`, {
      method: "POST",
      body: JSON.stringify(payload),
    })
    return this.toRef(data)
  }

  async updatePage(args: {
    pageId: string
    title: string
    storageBody: string
    currentVersion: number
    parentId?: string | null
    message?: string
  }): Promise<ConfluencePageRef> {
    const payload: Record<string, unknown> = {
      id: args.pageId,
      status: "current",
      title: args.title,
      body: { representation: "storage", value: args.storageBody },
      version: {
        number: args.currentVersion + 1,
        message: args.message || "synced from arch-tool",
      },
    }
    if (args.parentId) payload.parentId = args.parentId
    const data = await this.request<CloudPageResponse>(
      `/wiki/api/v2/pages/${encodeURIComponent(args.pageId)}`,
      { method: "PUT", body: JSON.stringify(payload) }
    )
    return this.toRef(data)
  }

  async deletePage(pageId: string): Promise<void> {
    await this.request<void>(
      `/wiki/api/v2/pages/${encodeURIComponent(pageId)}`,
      { method: "DELETE" }
    )
  }

  // Create or update an attachment by filename. Attachments still use the
  // v1 REST API on Cloud (v2 has no attachment-create). Multipart upload
  // with the XSRF-bypass header; existing filename → POST to its /data.
  async uploadAttachment(
    pageId: string,
    filename: string,
    contentType: string,
    data: Uint8Array
  ): Promise<void> {
    const existingId = await this.findAttachmentId(pageId, filename)
    const path = existingId
      ? `/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/attachment/${encodeURIComponent(existingId)}/data`
      : `/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/attachment`
    const form = new FormData()
    form.append("file", new Blob([data as BlobPart], { type: contentType }), filename)
    form.append("minorEdit", "true")
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "X-Atlassian-Token": "nocheck",
        Accept: "application/json",
      },
      body: form,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new ConfluenceHttpError(
        res.status,
        `Confluence attachment upload ${filename} → ${res.status}: ${body.slice(0, 300)}`
      )
    }
  }

  private async findAttachmentId(pageId: string, filename: string): Promise<string | null> {
    const params = new URLSearchParams({ filename, limit: "1" })
    try {
      const data = await this.request<{ results?: Array<{ id: string }> }>(
        `/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/attachment?${params.toString()}`
      )
      return data.results?.[0]?.id || null
    } catch {
      return null
    }
  }

  async findPageByTitleInSpace(
    title: string
  ): Promise<ConfluencePageRef | null> {
    const params = new URLSearchParams({
      "space-id": this.spaceId,
      title,
      limit: "5",
      "body-format": "storage",
    })
    const data = await this.request<{ results: CloudPageResponse[] }>(
      `/wiki/api/v2/pages?${params.toString()}`
    )
    const match = data.results.find((r) => r.title === title)
    if (!match) return null
    return this.toRef(match)
  }

  async findPageByComponentId(
    componentId: string
  ): Promise<ConfluencePageRef | null> {
    const suffix = `(${componentId})`
    let cursor: string | undefined = undefined
    for (let page = 0; page < 5; page++) {
      const params = new URLSearchParams({ limit: "100" })
      if (cursor) params.set("cursor", cursor)
      const data = await this.request<{
        results: CloudPageResponse[]
        _links?: { next?: string }
      }>(
        `/wiki/api/v2/spaces/${encodeURIComponent(this.spaceId)}/pages?${params.toString()}`
      )
      const match = data.results.find((r) => r.title.endsWith(suffix))
      if (match) return this.toRef(match)
      const next = data._links?.next
      if (!next) break
      const m = next.match(/[?&]cursor=([^&]+)/)
      if (!m) break
      cursor = decodeURIComponent(m[1])
    }
    return null
  }

  describe(): ConfluenceDescribe {
    return {
      edition: "cloud",
      baseUrl: this.baseUrl,
      space: { type: "spaceId", value: this.spaceId },
      authScheme: "Basic (email + API token)",
      authHint: maskSecret(this.apiToken),
      email: this.email,
      apiPathTemplate: "/wiki/api/v2/pages",
    }
  }

  async probe(): Promise<ProbeTrace> {
    const params = new URLSearchParams({
      "space-id": this.spaceId,
      title: "__arch-tool-healthcheck-nonexistent__",
      limit: "1",
    })
    return runHttpProbe({
      method: "GET",
      url: `${this.baseUrl}/wiki/api/v2/pages?${params.toString()}`,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
      },
      providerLabel: "Confluence Cloud",
    })
  }

  async listSpacePages(): Promise<ConfluencePageNode[]> {
    const out: ConfluencePageNode[] = []
    let cursor: string | undefined = undefined
    // Cap at ~1000 pages (10 × 100) so a huge space can't stall the picker.
    // Uses the space-id query filter on /pages — the same proven shape as
    // the probe and title lookup (the /spaces/{id}/pages path 404s here).
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({ "space-id": this.spaceId, limit: "100" })
      if (cursor) params.set("cursor", cursor)
      const data = await this.request<{
        results: CloudPageResponse[]
        _links?: { next?: string }
      }>(
        `/wiki/api/v2/pages?${params.toString()}`
      )
      for (const r of data.results) {
        out.push({ id: r.id, title: r.title, parentId: r.parentId ?? null })
      }
      const next = data._links?.next
      if (!next) break
      const m = next.match(/[?&]cursor=([^&]+)/)
      if (!m) break
      cursor = decodeURIComponent(m[1])
    }
    return out
  }

  private toRef(data: CloudPageResponse): ConfluencePageRef {
    const webui = data._links.webui
    return {
      id: data.id,
      title: data.title,
      spaceId: data.spaceId,
      parentId: data.parentId,
      version: data.version,
      webui,
      fullUrl: buildPageUrl(data._links.base, `${this.baseUrl}/wiki`, webui),
    }
  }

  private toFull(data: CloudPageResponse): ConfluencePageFull {
    return {
      ...this.toRef(data),
      body: data.body?.storage.value || "",
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new ConfluenceHttpError(
        res.status,
        `Confluence ${init?.method || "GET"} ${path} → ${res.status}: ${body.slice(0, 500)}`
      )
    }
    if (res.status === 204) return undefined as unknown as T
    return (await res.json()) as T
  }
}
