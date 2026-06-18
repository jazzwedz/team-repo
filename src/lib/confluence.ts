// Public Confluence surface used by API routes and Confluence-aware UI.
//
// This file is a thin facade that delegates to the active edition provider
// (Cloud or Data Center) selected by the CONFLUENCE_EDITION env var. The
// provider lives in src/lib/confluence/ — switching editions is just an
// env-var change followed by a restart.

import { getConfluenceProvider } from "./confluence/index"
import type {
  ConfluencePageRef,
  ConfluencePageFull,
  ConfluencePageNode,
} from "./confluence/types"

export { isConfluenceConfigured, getConfluenceEdition } from "./confluence/index"
export { ConfluenceHttpError } from "./confluence/types"
export type {
  ConfluencePageRef,
  ConfluencePageFull,
  ConfluencePageNode,
} from "./confluence/types"

export function listSpacePages(): Promise<ConfluencePageNode[]> {
  return getConfluenceProvider().listSpacePages()
}

export function getPage(pageId: string): Promise<ConfluencePageFull> {
  return getConfluenceProvider().getPage(pageId)
}

export function createPage(args: {
  title: string
  storageBody: string
  parentId?: string | null
}): Promise<ConfluencePageRef> {
  return getConfluenceProvider().createPage(args)
}

export function updatePage(args: {
  pageId: string
  title: string
  storageBody: string
  currentVersion: number
  parentId?: string | null
  message?: string
}): Promise<ConfluencePageRef> {
  return getConfluenceProvider().updatePage(args)
}

export function deletePage(pageId: string): Promise<void> {
  return getConfluenceProvider().deletePage(pageId)
}

export function findPageByTitleInSpace(
  title: string
): Promise<ConfluencePageRef | null> {
  return getConfluenceProvider().findPageByTitleInSpace(title)
}

export function findPageByComponentId(
  componentId: string
): Promise<ConfluencePageRef | null> {
  return getConfluenceProvider().findPageByComponentId(componentId)
}

// Capability "folder" pages are organised by title under the space root.
// They are the parent for the component pages that implement that
// capability. If missing, we auto-create them so publish does not bail
// on a missing parent.
export async function findOrCreateCapabilityPage(
  capabilityName: string
): Promise<ConfluencePageRef> {
  const safe = capabilityName.trim() || "Uncategorized"
  const existing = await findPageByTitleInSpace(safe)
  if (existing) return existing
  return createPage({
    title: safe,
    storageBody: `<p>Components in capability <strong>${escapeXml(safe)}</strong> are listed below.</p><p><em>Auto-created by arch-tool. Do not rename — page tree mirrors the architecture catalog.</em></p>`,
  })
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}
