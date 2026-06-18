// Full-catalog text export, designed for LLM consumption.
//
// Produces a single markdown document that surfaces *every* field of
// *every* component — including the empty ones — so a model reading
// the export can answer two questions at once:
//
//   1. What do we have? (filled fields, declared edges, owners, …)
//   2. What is missing? (empty fields explicitly flagged with ❌ NOT
//      SET / ❌ NONE DEFINED rather than silently omitted).
//
// Structure:
//
//   - Header (timestamp, totals)
//   - At-a-glance summary (counts by type / status, average maturity,
//     repo-wide gap stats)
//   - Coverage matrix (compact one-line-per-component overview)
//   - Cross-cutting index (capabilities, processes, external labels)
//   - Per-component detail blocks
//
// Pure function — no I/O. The caller (a route or a client component)
// supplies the components array and an optional `generatedAt` string
// so the same input always produces byte-identical output (handy when
// piping into git or diffing across days).

import type { Component, ComponentLink } from "./types"
import {
  TYPE_LABELS,
  LINK_ROLE_LABELS,
  INVERSE_LINK_ROLE_LABELS,
  CAPABILITY_ROLE_LABELS,
  PROCESS_ROLE_LABELS,
  RULE_KIND_LABELS,
} from "./constants"
import { computeMaturity } from "./component-maturity"

const MISSING_FIELD = "❌ NOT SET"
const MISSING_LIST = "❌ NONE DEFINED"
const MISSING_BLOCK = "❌ NONE"

export interface CatalogExportOptions {
  /** ISO date string. Defaults to `"unknown"` so the function stays pure. */
  generatedAt?: string
}

interface BacklinkBundle {
  /** v2: unified `links` source covers every inbound edge — relationships, interfaces and data flow. */
  links: Array<{ from: Component; link: ComponentLink }>
}

export function buildCatalogMarkdown(
  components: Component[],
  options: CatalogExportOptions = {}
): string {
  const generatedAt = options.generatedAt ?? "unknown"
  const sorted = [...components].sort((a, b) => a.id.localeCompare(b.id))
  const backlinks = buildBacklinkIndex(sorted)
  const out: string[] = []

  // -------- header --------
  out.push(`# Catalog Export`)
  out.push(``)
  out.push(`Generated for LLM consumption. Every component below shows`)
  out.push(`every field of the data model — missing fields are flagged`)
  out.push(`explicitly with ${MISSING_FIELD}, ${MISSING_LIST} or ${MISSING_BLOCK}`)
  out.push(`so a model can identify gaps without re-reading the schema.`)
  out.push(``)
  out.push(`- **Generated at:** ${generatedAt}`)
  out.push(`- **Total components:** ${sorted.length}`)
  out.push(``)
  out.push(`> The canonical schema reference lives in`)
  out.push(`> \`docs/COMPONENT_MODEL.md\`. Pair this export with that doc`)
  out.push(`> when asking the model to audit / extend the catalog.`)
  out.push(``)

  // -------- at-a-glance --------
  out.push(`## At-a-glance`)
  out.push(``)
  out.push(...renderAtAGlance(sorted))
  out.push(``)

  // -------- coverage matrix --------
  out.push(`## Coverage matrix`)
  out.push(``)
  out.push(...renderCoverageMatrix(sorted))
  out.push(``)

  // -------- cross-cutting index --------
  out.push(`## Cross-cutting index`)
  out.push(``)
  out.push(...renderCrossCutting(sorted))
  out.push(``)

  // -------- per-component --------
  out.push(`## Components`)
  out.push(``)
  for (const c of sorted) {
    out.push(...renderComponent(c, backlinks))
    out.push(``)
    out.push(`---`)
    out.push(``)
  }

  return out.join("\n")
}

// ============================ at-a-glance ============================

function renderAtAGlance(components: Component[]): string[] {
  const lines: string[] = []

  // By type
  const byType = new Map<string, number>()
  for (const c of components) byType.set(c.type, (byType.get(c.type) ?? 0) + 1)
  const typeRows = Array.from(byType.entries()).sort((a, b) => b[1] - a[1])
  if (typeRows.length > 0) {
    lines.push(`**By type:** ${typeRows.map(([t, n]) => `${TYPE_LABELS[t as keyof typeof TYPE_LABELS] ?? t} (${n})`).join(", ")}`)
    lines.push(``)
  }

  // By status
  const byStatus = new Map<string, number>()
  for (const c of components) byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1)
  const statusRows = Array.from(byStatus.entries()).sort((a, b) => b[1] - a[1])
  if (statusRows.length > 0) {
    lines.push(`**By status:** ${statusRows.map(([s, n]) => `${s} (${n})`).join(", ")}`)
    lines.push(``)
  }

  // By owner
  const byOwner = new Map<string, number>()
  for (const c of components) {
    const o = c.owner?.trim() || "(unowned)"
    byOwner.set(o, (byOwner.get(o) ?? 0) + 1)
  }
  const ownerRows = Array.from(byOwner.entries()).sort((a, b) => b[1] - a[1])
  if (ownerRows.length > 0) {
    lines.push(`**By owner:** ${ownerRows.map(([o, n]) => `${o} (${n})`).join(", ")}`)
    lines.push(``)
  }

  // Maturity
  if (components.length > 0) {
    let totalPercent = 0
    const bands: Record<string, number> = {
      Skeletal: 0,
      Drafted: 0,
      Solid: 0,
      Complete: 0,
    }
    for (const c of components) {
      const m = computeMaturity(c)
      totalPercent += m.percent
      bands[m.bandLabel] = (bands[m.bandLabel] ?? 0) + 1
    }
    const avg = Math.round(totalPercent / components.length)
    lines.push(`**Average documentation maturity:** ${avg}%`)
    lines.push(``)
    lines.push(
      `**Maturity bands:** Complete (${bands.Complete}), Solid (${bands.Solid}), Drafted (${bands.Drafted}), Skeletal (${bands.Skeletal})`
    )
    lines.push(``)
  }

  // Gap stats — count how many components miss each maturity field
  if (components.length > 0) {
    const gapCounts = new Map<string, { label: string; count: number }>()
    for (const c of components) {
      const m = computeMaturity(c)
      for (const f of m.fields) {
        if (!f.filled) {
          const cur = gapCounts.get(f.key) ?? { label: f.label, count: 0 }
          cur.count++
          gapCounts.set(f.key, cur)
        }
      }
    }
    const sorted = Array.from(gapCounts.entries()).sort((a, b) => b[1].count - a[1].count)
    if (sorted.length > 0) {
      lines.push(`**Repo-wide gaps** (components missing each field):`)
      lines.push(``)
      for (const [, { label, count }] of sorted) {
        const pct = Math.round((count / components.length) * 100)
        lines.push(`- ${label}: **${count}** / ${components.length} (${pct}%) missing`)
      }
    }
  }

  return lines
}

// ============================ coverage matrix ============================

function renderCoverageMatrix(components: Component[]): string[] {
  const lines: string[] = []
  lines.push(
    `| ID | Name | Type | Status | Owner | Maturity | Desc | Links | Caps | Procs | Rules | NFR | Risks |`
  )
  lines.push(
    `|---|---|---|---|---|---|---|---|---|---|---|---|---|`
  )
  for (const c of components) {
    const m = computeMaturity(c)
    const desc = m.fields.find((f) => f.key === "description")?.filled ? "✓" : "❌"
    const links = (c.links || []).length
    const caps = (c.capabilities || []).length
    const procs = (c.processes || []).length
    const rules = (c.rules || []).length
    const nfr =
      c.nfr && Object.values(c.nfr).some((v) => !!v) ? "✓" : "❌"
    const risks = (c.risks || []).length
    lines.push(
      `| \`${c.id}\` | ${c.name} | ${c.type} | ${c.status} | ${c.owner || "❌"} | ${m.percent}% | ${desc} | ${links || "❌"} | ${caps || "❌"} | ${procs || "❌"} | ${rules || "❌"} | ${nfr} | ${risks || "❌"} |`
    )
  }
  return lines
}

// ============================ cross-cutting ============================

function renderCrossCutting(components: Component[]): string[] {
  const lines: string[] = []

  // Capabilities — name → [{component, role}]
  const capMap = new Map<string, { id: string; name: string; role: string }[]>()
  for (const c of components) {
    for (const cap of c.capabilities || []) {
      const arr = capMap.get(cap.name) ?? []
      arr.push({ id: c.id, name: c.name, role: cap.role })
      capMap.set(cap.name, arr)
    }
  }
  if (capMap.size > 0) {
    lines.push(`### Capabilities`)
    lines.push(``)
    const sortedCaps = Array.from(capMap.entries()).sort()
    for (const [cap, refs] of sortedCaps) {
      lines.push(
        `- **${cap}** — ${refs.map((r) => `${r.name} (${CAPABILITY_ROLE_LABELS[r.role as keyof typeof CAPABILITY_ROLE_LABELS] ?? r.role})`).join(", ")}`
      )
    }
    lines.push(``)
  } else {
    lines.push(`### Capabilities`)
    lines.push(``)
    lines.push(`${MISSING_LIST} (no component declares any capability).`)
    lines.push(``)
  }

  // Processes — name → [{component, role}]
  const procMap = new Map<string, { id: string; name: string; role: string }[]>()
  for (const c of components) {
    for (const p of c.processes || []) {
      const arr = procMap.get(p.name) ?? []
      arr.push({ id: c.id, name: c.name, role: p.role })
      procMap.set(p.name, arr)
    }
  }
  if (procMap.size > 0) {
    lines.push(`### Processes`)
    lines.push(``)
    const sortedProcs = Array.from(procMap.entries()).sort()
    for (const [proc, refs] of sortedProcs) {
      lines.push(
        `- **${proc}** — ${refs.map((r) => `${r.name} (${PROCESS_ROLE_LABELS[r.role as keyof typeof PROCESS_ROLE_LABELS] ?? r.role})`).join(", ")}`
      )
    }
    lines.push(``)
  }

  // External labels referenced — targets that are NOT in the catalog
  const idSet = new Set(components.map((c) => c.id))
  const externalTargets = new Map<string, { id: string; name: string; via: string }[]>()
  for (const c of components) {
    for (const link of c.links || []) {
      if (link.target && !idSet.has(link.target)) {
        const arr = externalTargets.get(link.target) ?? []
        arr.push({
          id: c.id,
          name: c.name,
          via: `link (${link.role}${link.protocol ? `, ${link.protocol}` : ""})`,
        })
        externalTargets.set(link.target, arr)
      }
    }
  }
  if (externalTargets.size > 0) {
    lines.push(`### External / unknown targets referenced`)
    lines.push(``)
    lines.push(`These ids appear as targets but do **not** correspond to`)
    lines.push(`any component in the catalog. They are either external`)
    lines.push(`systems modelled as free labels, or broken references.`)
    lines.push(``)
    const sortedExt = Array.from(externalTargets.entries()).sort()
    for (const [t, refs] of sortedExt) {
      lines.push(
        `- \`${t}\` — referenced by ${refs.map((r) => `${r.name} (${r.via})`).join(", ")}`
      )
    }
    lines.push(``)
  }

  return lines
}

// ============================ per-component ============================

function renderComponent(c: Component, backlinks: Map<string, BacklinkBundle>): string[] {
  const lines: string[] = []
  const m = computeMaturity(c)

  lines.push(`### \`${c.id}\` — ${c.name}`)
  lines.push(``)
  lines.push(`- **Type:** ${c.type} (${TYPE_LABELS[c.type as keyof typeof TYPE_LABELS] ?? c.type})`)
  lines.push(`- **Status:** ${c.status}`)
  lines.push(`- **Owner:** ${c.owner?.trim() || MISSING_FIELD}`)
  lines.push(`- **Tags:** ${(c.tags || []).length > 0 ? c.tags.join(", ") : MISSING_BLOCK}`)
  lines.push(`- **Documentation maturity:** ${m.percent}% (${m.filled}/${m.total} fields) — ${m.bandLabel}`)
  lines.push(``)

  // Description
  lines.push(`**Description**`)
  lines.push(``)
  const descText =
    c.description?.description?.trim() ||
    c.description?.technical?.trim() ||
    c.description?.business?.trim()
  if (descText) {
    for (const ln of descText.split("\n")) lines.push(`> ${ln}`)
  } else {
    lines.push(`> ${MISSING_FIELD}`)
  }
  if (c.description?.oneliner?.trim()) {
    lines.push(``)
    lines.push(`*One-liner:* ${c.description.oneliner.trim()}`)
  }
  lines.push(``)

  // v2 — single Links section replaces the legacy
  // Interfaces + Outbound relationships pair. Read every edge from
  // `links[]` and present role / protocol / target / description.
  const links = c.links || []
  lines.push(`**Links (${links.length})**`)
  lines.push(``)
  if (links.length === 0) {
    lines.push(MISSING_LIST)
  } else {
    for (const link of links) {
      const role = LINK_ROLE_LABELS[link.role] ?? link.role
      const proto = link.protocol ? ` [${link.protocol}]` : ""
      const head = link.name ? ` "${link.name}"` : ""
      const target = link.target ? ` → \`${link.target}\`` : " → (no target)"
      lines.push(`- ${role}${proto}${head}${target}`)
      if (link.description?.trim()) {
        lines.push(`  ${link.description.trim()}`)
      }
    }
  }
  lines.push(``)

  // Inbound (backlinks)
  const bl = backlinks.get(c.id)
  lines.push(`**Inbound (declared on other components)**`)
  lines.push(``)
  if (!bl || bl.links.length === 0) {
    lines.push(MISSING_BLOCK)
  } else {
    for (const r of bl.links) {
      const inv = INVERSE_LINK_ROLE_LABELS[r.link.role] ?? r.link.role
      const proto = r.link.protocol ? ` [${r.link.protocol}]` : ""
      const name = r.link.name ? ` "${r.link.name}"` : ""
      lines.push(
        `- ${r.from.name} (\`${r.from.id}\`) declares "${r.link.role}"${proto}${name} → reads here as "${inv}"`
      )
    }
  }
  lines.push(``)

  // Capabilities
  lines.push(`**Capabilities (${(c.capabilities || []).length})**`)
  lines.push(``)
  if ((c.capabilities || []).length === 0) {
    lines.push(MISSING_LIST)
  } else {
    for (const cap of c.capabilities!) {
      const role = CAPABILITY_ROLE_LABELS[cap.role] ?? cap.role
      lines.push(`- ${cap.name} [${role}]${cap.description ? ` — ${cap.description}` : ""}`)
    }
  }
  lines.push(``)

  // Processes
  lines.push(`**Processes (${(c.processes || []).length})**`)
  lines.push(``)
  if ((c.processes || []).length === 0) {
    lines.push(MISSING_LIST)
  } else {
    for (const p of c.processes!) {
      const role = PROCESS_ROLE_LABELS[p.role] ?? p.role
      lines.push(
        `- ${p.name} [${role}]${p.activity ? ` — ${p.activity}` : ""}${p.description ? ` (${p.description})` : ""}`
      )
    }
  }
  lines.push(``)

  // Rules
  lines.push(`**Rules & calculations (${(c.rules || []).length})**`)
  lines.push(``)
  if ((c.rules || []).length === 0) {
    lines.push(MISSING_LIST)
  } else {
    for (const r of c.rules!) {
      const kind = RULE_KIND_LABELS[r.kind] ?? r.kind
      lines.push(`- [${kind}] **${r.name}**${r.summary ? ` — ${r.summary}` : ""}`)
      if (r.kind === "formula" && r.formula) {
        lines.push(`  Formula: \`${r.formula}\``)
      }
      if (r.kind === "rule") {
        if (r.given) lines.push(`  Given: ${r.given}`)
        if (r.when) lines.push(`  When: ${r.when}`)
        if (r.then) lines.push(`  Then: ${r.then}`)
      }
      if (r.kind === "constraint" && r.enforced_in && r.enforced_in.length > 0) {
        lines.push(`  Enforced in: ${r.enforced_in.map((id) => `\`${id}\``).join(", ")}`)
      }
      if (r.description) {
        lines.push(`  ${r.description}`)
      }
    }
  }
  lines.push(``)

  // v2 Phase 2: data{} is gone — input/output flows are now
  // reads-from / writes-to entries inside the Links section above.
  // No separate Data flow block; the link's `name` field carries the
  // legacy DataItem name when one existed.

  // NFR
  lines.push(`**Non-functional requirements**`)
  lines.push(``)
  const nfr = c.nfr || {}
  const nfrFields: Array<[string, string | undefined]> = [
    ["Availability", nfr.availability],
    ["RTO", nfr.rto],
    ["RPO", nfr.rpo],
    ["Max latency", nfr.max_latency],
    ["Throughput", nfr.throughput],
    ["Data classification", nfr.data_classification],
    ["Scaling", nfr.scaling],
  ]
  let nfrAny = false
  for (const [label, val] of nfrFields) {
    if (val) {
      lines.push(`- ${label}: ${val}`)
      nfrAny = true
    } else {
      lines.push(`- ${label}: ${MISSING_FIELD}`)
    }
  }
  if (!nfrAny) {
    lines.push(``)
    lines.push(`(every NFR field unset)`)
  }
  lines.push(``)

  // Diagram
  lines.push(`**Diagram overrides**`)
  lines.push(``)
  if (c.diagram?.color || c.diagram?.shape) {
    if (c.diagram.color) lines.push(`- Color: ${c.diagram.color}`)
    if (c.diagram.shape) lines.push(`- Shape: ${c.diagram.shape}`)
  } else {
    lines.push(MISSING_BLOCK)
  }
  lines.push(``)

  // Risks
  lines.push(`**Risks (${(c.risks || []).length})**`)
  lines.push(``)
  if ((c.risks || []).length === 0) {
    lines.push(MISSING_LIST)
  } else {
    for (const r of c.risks!) lines.push(`- ${r}`)
  }
  lines.push(``)

  // Data-model link (table-only)
  if (c.type === "table") {
    lines.push(`**Data Model registry link** (table only)`)
    lines.push(``)
    if (c.data_model?.entity) {
      lines.push(`- Entity: \`${c.data_model.entity}\``)
    } else {
      lines.push(MISSING_FIELD)
    }
    lines.push(``)
  }

  // Missing field summary
  const missing = m.fields.filter((f) => !f.filled).map((f) => f.label)
  lines.push(`**Missing / empty fields:** ${missing.length === 0 ? "none — complete ✓" : missing.join(", ")}`)

  return lines
}

// ============================ backlink index ============================

function buildBacklinkIndex(components: Component[]): Map<string, BacklinkBundle> {
  const map = new Map<string, BacklinkBundle>()
  const ensure = (id: string): BacklinkBundle => {
    let bundle = map.get(id)
    if (!bundle) {
      bundle = { links: [] }
      map.set(id, bundle)
    }
    return bundle
  }

  for (const c of components) {
    // v2: scan unified links[]. Data flow (reads-from / writes-to)
    // is part of the same array now, so one pass covers every edge.
    for (const link of c.links || []) {
      if (!link.target) continue
      ensure(link.target).links.push({ from: c, link })
    }
  }
  return map
}
