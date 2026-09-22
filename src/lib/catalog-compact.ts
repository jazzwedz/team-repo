// Compact catalog digest for composition prompts.
//
// The full LLM export (catalog-export.ts) is an audit document: every
// field of every component, missing-field flags, backlinks, maturity. For
// AI solution compose that ran to ~175k characters on a mid-sized catalog
// and buried the one thing the model must get right — the exact component
// ids — under noise; the model answered with a near-empty skeleton. This
// digest is one line per component (id first, backticked), plus one short
// line of what it offers, so a catalog of a hundred components fits in a
// few tens of thousands of characters.
//
// Client-safe: pure function over the catalog.

import type { Component } from "./types"

const DESC_MAX = 220
const CAPS_MAX = 8
const LINKS_MAX = 10
const TAGS_MAX = 6

function oneLine(s: string | undefined, max: number): string {
  const t = (s || "").replace(/\s+/g, " ").trim()
  return t.length > max ? t.slice(0, max) + "…" : t
}

export function buildCompactCatalog(components: Component[]): string {
  const sorted = [...components].sort((a, b) => a.id.localeCompare(b.id))
  const ids = new Set(sorted.map((c) => c.id))
  const lines: string[] = [
    `Components (${sorted.length}) — one per line; the backticked token at the start of each line is the EXACT id to use.`,
    ``,
  ]
  for (const c of sorted) {
    const desc = oneLine(c.description?.oneliner || c.description?.description, DESC_MAX)
    const meta = [c.type, c.status, c.owner ? `owner: ${c.owner}` : ""].filter(Boolean).join(", ")
    lines.push(`- \`${c.id}\` — ${c.name} [${meta}]${desc ? `: ${desc}` : ""}`)

    const extra: string[] = []
    const caps = (c.capabilities || []).map((x) => x.name).filter(Boolean)
    if (caps.length) {
      extra.push(
        `capabilities: ${caps.slice(0, CAPS_MAX).join("; ")}${caps.length > CAPS_MAX ? ` (+${caps.length - CAPS_MAX})` : ""}`
      )
    }
    const rules = (c.rules || []).length
    if (rules) extra.push(`${rules} business rule(s)`)
    const tags = (c.tags || []).slice(0, TAGS_MAX)
    if (tags.length) extra.push(`tags: ${tags.join(", ")}`)
    const links = (c.links || []).slice(0, LINKS_MAX).map((l) => {
      const target = ids.has(l.target) ? `\`${l.target}\`` : l.target
      return `${l.role}${l.protocol ? `/${l.protocol}` : ""} → ${target}`
    })
    if (links.length) {
      extra.push(`links: ${links.join(", ")}${(c.links || []).length > LINKS_MAX ? " (+more)" : ""}`)
    }
    if (extra.length) lines.push(`  ${extra.join(" · ")}`)
  }
  return lines.join("\n")
}
