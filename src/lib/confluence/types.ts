// Confluence provider abstraction.
//
// Two backends ship in the box:
//   - cloud       — Confluence Cloud, v2 REST API, Basic auth (email + API token)
//   - datacenter  — Confluence Data Center / Server, v1 REST API, Bearer PAT
//
// Both expose the same `ConfluenceProvider` surface so callers (publish,
// pull-smart, status, etc.) don't care which edition is on the other end.
//
// `spaceId` in the page refs holds the numeric space id on Cloud and the
// space key on Data Center — it's informational only (stored in the
// per-component link side-file, never used for further API calls).

import type { ProbeTrace } from "../diagnostics"

export interface ConfluencePageRef {
  id: string
  title: string
  spaceId: string
  parentId?: string | null
  version: { number: number }
  webui: string
  fullUrl: string
}

export interface ConfluencePageFull extends ConfluencePageRef {
  body: string // storage format XHTML
}

// A lightweight node in the space page tree, used to render the parent
// picker when publishing a DSD. `parentId` is null for top-level pages.
export interface ConfluencePageNode {
  id: string
  title: string
  parentId: string | null
}

export interface ConfluenceDescribe {
  edition: "cloud" | "datacenter"
  baseUrl: string
  // For Cloud: { type: 'spaceId', value: '229575' }
  // For DC:    { type: 'spaceKey', value: 'TR' }
  space: { type: "spaceId" | "spaceKey"; value: string }
  authScheme: string
  authHint: string
  // For Cloud only — the account email is not a secret and helps
  // disambiguate which user the integration runs as.
  email?: string
  apiPathTemplate: string
}

export interface ConfluenceProvider {
  readonly edition: "cloud" | "datacenter"

  getPage(pageId: string): Promise<ConfluencePageFull>

  createPage(args: {
    title: string
    storageBody: string
    parentId?: string | null
  }): Promise<ConfluencePageRef>

  updatePage(args: {
    pageId: string
    title: string
    storageBody: string
    currentVersion: number
    parentId?: string | null
    message?: string
  }): Promise<ConfluencePageRef>

  deletePage(pageId: string): Promise<void>

  // Create or update (by filename) a binary attachment on a page. Used to
  // publish rendered diagram images so they show without a Confluence
  // plugin. Re-publish overwrites the same filename (new attachment version).
  uploadAttachment(
    pageId: string,
    filename: string,
    contentType: string,
    data: Uint8Array
  ): Promise<void>

  findPageByTitleInSpace(title: string): Promise<ConfluencePageRef | null>
  findPageByComponentId(componentId: string): Promise<ConfluencePageRef | null>

  // Flat list of pages in the configured space (capped), for the DSD
  // parent picker. Order is provider-defined; the caller builds the tree.
  listSpacePages(): Promise<ConfluencePageNode[]>

  // Sanitized self-description for the Settings UI. Sync, no network.
  describe(): ConfluenceDescribe

  // Verbose four-step probe: DNS, request, response, classify.
  probe(): Promise<ProbeTrace>
}

export class ConfluenceHttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "ConfluenceHttpError"
    this.status = status
  }
}
