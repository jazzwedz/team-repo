// Confluence URL → extracted text.
//
// Accepted URL shapes:
//   - Cloud:  https://acme.atlassian.net/wiki/spaces/TR/pages/{ID}/...
//   - DC:     https://confluence.acme.com/pages/viewpage.action?pageId={ID}
//   - DC:     https://confluence.acme.com/...?pageId={ID}&...
//   - bare:   {ID}                              (numeric page id directly)
//
// `/display/SPACE/Title` URLs without a pageId are rejected with a clear
// message — resolving by title would require a search call per edition
// and is not worth the complexity in v1.

import {
  getConfluenceProvider,
  isConfluenceConfigured,
} from "@/lib/confluence/index"
import { confluenceStorageToText } from "@/lib/confluence-storage-text"
import { ExtractError, type ExtractedDoc } from "./types"

const PAGE_ID_FROM_PATH = /\/pages\/(\d+)(?:\/|\?|$)/
const PAGE_ID_FROM_QUERY = /[?&]pageId=(\d+)/i
const BARE_PAGE_ID = /^\s*(\d{4,})\s*$/

export function resolvePageIdFromUrl(input: string): string | null {
  const bare = input.match(BARE_PAGE_ID)
  if (bare) return bare[1]
  const path = input.match(PAGE_ID_FROM_PATH)
  if (path) return path[1]
  const query = input.match(PAGE_ID_FROM_QUERY)
  if (query) return query[1]
  return null
}

export async function extractConfluence(urlOrId: string): Promise<ExtractedDoc> {
  if (!isConfluenceConfigured()) {
    throw new ExtractError(
      "Confluence is not configured — set the CONFLUENCE_* env vars first."
    )
  }
  const pageId = resolvePageIdFromUrl(urlOrId)
  if (!pageId) {
    throw new ExtractError(
      `Could not resolve a page id from "${urlOrId}". Paste a URL that contains "/pages/{id}/" or "?pageId={id}", or paste the numeric page id directly. /display/Title URLs are not supported — open the page in Confluence and copy the URL bar.`
    )
  }

  let page
  try {
    page = await getConfluenceProvider().getPage(pageId)
  } catch (err) {
    throw new ExtractError(
      `Failed to fetch Confluence page ${pageId}: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  // 120000 chars ≈ 30K tokens — generous for one page, still capped so
  // pathological pages do not blow out the context.
  const text = confluenceStorageToText(page.body || "", 120000)
  if (!text.trim()) {
    throw new ExtractError(
      `Confluence page "${page.title}" (${pageId}) appears to be empty after stripping macros.`
    )
  }

  return {
    kind: "confluence",
    name: `Confluence: ${page.title}`,
    text,
    confluencePageId: pageId,
    confluenceUrl: page.fullUrl,
  }
}
