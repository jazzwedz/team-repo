// Build the public, clickable page URL.
//
// We prefer the base URL Confluence itself reports in the API response
// (`_links.base`) over hardcoding a `/wiki` context path — different
// instances expose pages under different prefixes, and the previous
// hardcoded `${baseUrl}/wiki${webui}` produced links that did not match
// the user's actual access path. When the response carries no base we
// fall back to the provided default (which the provider sets to the
// edition's conventional prefix).
//
// `webui` may already be absolute (some responses return a full URL); in
// that case it wins outright. An accidental `/wiki/wiki/` (default base
// already ending in /wiki + a webui that also starts with /wiki) is
// collapsed so the link stays valid.
export function buildPageUrl(
  reportedBase: string | undefined | null,
  defaultBase: string,
  webui: string | undefined | null
): string {
  const path = webui || ""
  if (/^https?:\/\//i.test(path)) return path
  const base = (reportedBase && reportedBase.trim()) || defaultBase
  const cleanBase = base.replace(/\/+$/, "")
  const cleanPath = path.startsWith("/") ? path : path ? `/${path}` : ""
  return `${cleanBase}${cleanPath}`.replace(/\/wiki\/wiki\//, "/wiki/")
}
