// Confluence Data Center / Server adapter.
//
// API: v1 REST (`/rest/api/content`). Auth: Personal Access Token via
// Bearer header. Storage format only (no ADF — DC is XHTML-only anyway).
//
// Differences from Cloud:
//   - Space is identified by spaceKey (string, e.g. "TR"), not numeric.
//   - Page URL is `{base}{webui}` — there is no `/wiki` prefix.
//   - Body / version / ancestors must be requested via `expand=...`.
//   - List pagination uses `start` + `limit` integers, no opaque cursor.
//   - Search by title goes through `?spaceKey=...&title=...`.

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

interface DCPageResponse {
  id: string
  title: string
  version: { number: number; message?: string }
  space?: { key?: string }
  ancestors?: Array<{ id: string }>
  body?: { storage?: { value?: string; representation?: string } }
  _links?: { webui?: string; base?: string }
}

const API_VERSION_NOTE = ""
const EXPAND_PAGE = "body.storage,version,ancestors,space"
const EXPAND_REF = "version,ancestors,space"

export class ConfluenceDataCenterProvider implements ConfluenceProvider {
  readonly edition = "datacenter" as const
  private baseUrl: string
  private pat: string
  private spaceKey: string

  constructor(opts: { baseUrl: string; pat: string; spaceKey: string }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "")
    this.pat = opts.pat
    this.spaceKey = opts.spaceKey
  }

  async getPage(pageId: string): Promise<ConfluencePageFull> {
    const data = await this.request<DCPageResponse>(
      `/rest/api/content/${encodeURIComponent(pageId)}?expand=${EXPAND_PAGE}`
    )
    return this.toFull(data)
  }

  async createPage(args: {
    title: string
    storageBody: string
    parentId?: string | null
  }): Promise<ConfluencePageRef> {
    const payload: Record<string, unknown> = {
      type: "page",
      title: args.title,
      space: { key: this.spaceKey },
      body: {
        storage: { value: args.storageBody, representation: "storage" },
      },
    }
    if (args.parentId) payload.ancestors = [{ id: args.parentId }]
    const data = await this.request<DCPageResponse>(`/rest/api/content`, {
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
      version: {
        number: args.currentVersion + 1,
        message: args.message || "synced from arch-tool",
      },
      title: args.title,
      type: "page",
      body: {
        storage: { value: args.storageBody, representation: "storage" },
      },
    }
    if (args.parentId) payload.ancestors = [{ id: args.parentId }]
    const data = await this.request<DCPageResponse>(
      `/rest/api/content/${encodeURIComponent(args.pageId)}`,
      { method: "PUT", body: JSON.stringify(payload) }
    )
    return this.toRef(data)
  }

  async deletePage(pageId: string): Promise<void> {
    await this.request<void>(
      `/rest/api/content/${encodeURIComponent(pageId)}`,
      { method: "DELETE" }
    )
  }

  async findPageByTitleInSpace(
    title: string
  ): Promise<ConfluencePageRef | null> {
    const params = new URLSearchParams({
      spaceKey: this.spaceKey,
      title,
      limit: "5",
      expand: EXPAND_REF,
    })
    const data = await this.request<{ results: DCPageResponse[] }>(
      `/rest/api/content?${params.toString()}`
    )
    const match = data.results.find((r) => r.title === title)
    if (!match) return null
    return this.toRef(match)
  }

  async findPageByComponentId(
    componentId: string
  ): Promise<ConfluencePageRef | null> {
    const suffix = `(${componentId})`
    const pageSize = 100
    for (let start = 0; start < 500; start += pageSize) {
      const params = new URLSearchParams({
        spaceKey: this.spaceKey,
        type: "page",
        start: String(start),
        limit: String(pageSize),
        expand: EXPAND_REF,
      })
      const data = await this.request<{ results: DCPageResponse[] }>(
        `/rest/api/content?${params.toString()}`
      )
      const match = data.results.find((r) => r.title.endsWith(suffix))
      if (match) return this.toRef(match)
      if (data.results.length < pageSize) break
    }
    return null
  }

  describe(): ConfluenceDescribe {
    return {
      edition: "datacenter",
      baseUrl: this.baseUrl,
      space: { type: "spaceKey", value: this.spaceKey },
      authScheme: "Bearer PAT",
      authHint: maskSecret(this.pat),
      apiPathTemplate: "/rest/api/content",
    }
  }

  async probe(): Promise<ProbeTrace> {
    const params = new URLSearchParams({
      spaceKey: this.spaceKey,
      title: "__arch-tool-healthcheck-nonexistent__",
      limit: "1",
    })
    return runHttpProbe({
      method: "GET",
      url: `${this.baseUrl}/rest/api/content?${params.toString()}`,
      headers: {
        Authorization: `Bearer ${this.pat}`,
        Accept: "application/json",
      },
      providerLabel: "Confluence Data Center",
    })
  }

  async listSpacePages(): Promise<ConfluencePageNode[]> {
    const out: ConfluencePageNode[] = []
    const pageSize = 100
    // Cap at ~1000 pages so a huge space can't stall the picker.
    for (let start = 0; start < 1000; start += pageSize) {
      const params = new URLSearchParams({
        spaceKey: this.spaceKey,
        type: "page",
        start: String(start),
        limit: String(pageSize),
        expand: "ancestors",
      })
      const data = await this.request<{ results: DCPageResponse[] }>(
        `/rest/api/content?${params.toString()}`
      )
      for (const r of data.results) {
        const ancestors = r.ancestors || []
        out.push({
          id: r.id,
          title: r.title,
          parentId: ancestors[ancestors.length - 1]?.id ?? null,
        })
      }
      if (data.results.length < pageSize) break
    }
    return out
  }

  private toRef(data: DCPageResponse): ConfluencePageRef {
    const webui = data._links?.webui || ""
    const ancestors = data.ancestors || []
    const parent = ancestors[ancestors.length - 1]?.id
    return {
      id: data.id,
      title: data.title,
      // DC has no numeric space id; carry the spaceKey here. Existing
      // callers only persist the value to the link side-file — they
      // never query it back through the API.
      spaceId: data.space?.key || this.spaceKey,
      parentId: parent || null,
      version: { number: data.version.number },
      webui,
      // Prefer the canonical base Confluence reports in `_links.base`
      // (e.g. https://wiki.example.com) over CONFLUENCE_BASE_URL, which on
      // Data Center usually carries the `/wiki` REST context path and would
      // bleed a spurious `/wiki` into the browser link. The fallback strips
      // a trailing `/wiki` so the display URL stays correct even when the
      // response omits `_links.base`.
      fullUrl: buildPageUrl(
        data._links?.base,
        this.baseUrl.replace(/\/wiki$/, ""),
        webui
      ),
    }
  }

  private toFull(data: DCPageResponse): ConfluencePageFull {
    return {
      ...this.toRef(data),
      body: data.body?.storage?.value || "",
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}${API_VERSION_NOTE}`
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.pat}`,
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
