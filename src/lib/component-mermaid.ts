// Build small mermaid diagrams scoped to a single component's perspective.
// Used by per-section "Visualize" buttons on the detail page.
//
// All builders accept an optional `nameLookup` map: component id →
// component name. When provided, target ids in relationships and
// interfaces are rendered as the human-readable component name; when
// omitted (or the id is absent from the map), the raw id is used as
// fallback. Detail pages pass the catalog snapshot they already have,
// so the analyst never sees `acme_order_db_prod` in a label when the
// component is actually called "Acme Order DB (prod)".

import type { Component } from "./types"
import {
  RELATIONSHIP_LABELS,
  CAPABILITY_ROLE_LABELS,
} from "./constants"

export type NameLookup = Map<string, string>

// Caller-supplied relationship row, used by the hero context and the
// per-section Relationships visualizer. Lets the detail page pre-merge
// outbound (declared here) and inbound (declared on the other side,
// inverted via INVERSE_RELATIONSHIP_LABELS) into one list before
// handing it to the builders. The builders are then ignorant of the
// outbound/inbound distinction — they just draw an edge labelled
// `displayLabel` from the component to `target`.
export interface RelationshipForViz {
  target: string
  displayLabel: string
}

function safeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, "_")
}

// Mermaid lexes (){}[] as structural tokens even inside `-->|...|` edge
// labels, so a label like "Part of (group)" triggers a parse error. Map
// those characters to numeric HTML entity codes, which mermaid renders
// back to the literal glyph in both node and edge labels.
function escLabel(s: string): string {
  return s
    .replace(/"/g, "&quot;")
    .replace(/\n/g, " ")
    .replace(/\(/g, "#40;")
    .replace(/\)/g, "#41;")
    .replace(/\[/g, "#91;")
    .replace(/\]/g, "#93;")
    .replace(/\{/g, "#123;")
    .replace(/\}/g, "#125;")
}

// Resolve a component id to a display label. Falls back to the raw id
// when no lookup is provided or the id is not in the map (e.g. broken
// reference or external label typed into a target field).
function displayTarget(id: string, lookup?: NameLookup): string {
  if (!id) return ""
  return lookup?.get(id) || id
}


/**
 * Visualise the component's capabilities — which business capabilities it
 * supports and the role it plays in each. The component sits on the left;
 * capability nodes fan out to the right, edges labelled with the role.
 */
export function buildCapabilitiesMermaid(component: Component): string {
  const lines: string[] = ["flowchart LR"]
  const me = safeId(component.id)
  lines.push(`  ${me}["${escLabel(component.name)}"]:::self`)

  const caps = component.capabilities || []
  if (caps.length === 0) {
    lines.push(`  noop["No capabilities defined"]:::muted`)
    lines.push(`  classDef self fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px`)
    lines.push(`  classDef muted fill:#f3f4f6,stroke:#9ca3af,color:#6b7280`)
    return lines.join("\n")
  }

  caps.forEach((cap, i) => {
    const capId = `cap_${i}_${safeId(cap.name).slice(0, 24) || "x"}`
    const cls =
      cap.role === "owner"
        ? ":::owner"
        : cap.role === "contributor"
        ? ":::contributor"
        : cap.role === "consumer"
        ? ":::consumer"
        : ":::indirect"
    lines.push(`  ${capId}["${escLabel(cap.name)}"]${cls}`)
    const roleLabel = CAPABILITY_ROLE_LABELS[cap.role] || cap.role
    lines.push(`  ${me} -->|${escLabel(roleLabel)}| ${capId}`)
  })

  lines.push(`  classDef self fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px`)
  lines.push(`  classDef owner fill:#dbeafe,stroke:#2563eb,color:#1e3a8a`)
  lines.push(`  classDef contributor fill:#dcfce7,stroke:#16a34a,color:#14532d`)
  lines.push(`  classDef consumer fill:#f3f4f6,stroke:#6b7280,color:#374151`)
  lines.push(`  classDef indirect fill:#fef3c7,stroke:#d97706,color:#78350f`)
  return lines.join("\n")
}

/**

/**
 * Hero "Component context" diagram — combines interfaces, relationships,
 * inputs, outputs and owned data into a single flowchart so the user sees
 * the component in its environment at a glance. Used at the top of the
 * Overview tab on the detail page.
 *
 * The diagram is intentionally capped: at most 6 each of interfaces /
 * relationships and 8 inputs / outputs / owns. Beyond those counts the
 * picture stops telling a story.
 */
export function buildHeroContextMermaid(
  component: Component,
  nameLookup?: NameLookup,
  /**
   * Optional merged links list (outbound + inverted inbound). When
   * omitted the hero diagram falls back to whatever is on
   * `component.links` directly. Each entry is { target, displayLabel }.
   */
  linksOverride?: RelationshipForViz[]
): string {
  const lines: string[] = ["flowchart LR"]
  const me = safeId(component.id)

  const allLinks =
    linksOverride ??
    (component.links || []).map((l) => ({
      target: l.target,
      displayLabel: l.name || l.protocol || l.role,
    }))
  const links = allLinks.slice(0, 12)

  if (links.length === 0) {
    lines.push(`  ${me}["${escLabel(component.name)}"]:::self`)
    lines.push(
      `  noop["No links yet — start by adding them in Edit"]:::muted`
    )
    lines.push(
      `  classDef self fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px`
    )
    lines.push(`  classDef muted fill:#f3f4f6,stroke:#9ca3af,color:#6b7280`)
    return lines.join("\n")
  }

  lines.push(`  ${me}["${escLabel(component.name)}"]:::self`)

  // One node per distinct peer — a component linked several times shows
  // as a single box with multiple labelled edges, not a box per link.
  const peerNode = new Map<string, string>()
  links.forEach((l, i) => {
    const key = l.target || `__ext_${i}`
    let nid = peerNode.get(key)
    if (!nid) {
      nid = `peer_${safeId(l.target) || `ext_${i}`}`
      peerNode.set(key, nid)
      const otherLabel = displayTarget(l.target, nameLookup)
      lines.push(`  ${nid}["${escLabel(otherLabel)}"]:::peer`)
    }
    lines.push(`  ${me} -.${escLabel(l.displayLabel)}.- ${nid}`)
  })

  lines.push(
    `  classDef self fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:3px`
  )
  lines.push(`  classDef peer fill:#f9fafb,stroke:#6b7280,color:#374151`)
  return lines.join("\n")
}

/**
 * Visualise the component's relationships to other components in the catalog.
 * Edges are labelled with the relationship type.
 */
export function buildRelationshipsMermaid(
  component: Component,
  nameLookup?: NameLookup,
  /**
   * Same override semantics as buildHeroContextMermaid — allows the
   * detail page to pass the merged outbound + inverted inbound list.
   * Falls back to outbound only when omitted.
   */
  relationshipsOverride?: RelationshipForViz[]
): string {
  const lines: string[] = ["flowchart LR"]
  const me = safeId(component.id)
  lines.push(`  ${me}["${escLabel(component.name)}"]:::self`)

  const rels =
    relationshipsOverride ??
    (component.relationships || []).map((r) => ({
      target: r.target,
      displayLabel: RELATIONSHIP_LABELS[r.type] || r.type,
    }))
  if (rels.length === 0) {
    lines.push(`  noop["No relationships defined"]:::muted`)
    lines.push(`  classDef self fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px`)
    lines.push(`  classDef muted fill:#f3f4f6,stroke:#9ca3af,color:#6b7280`)
    return lines.join("\n")
  }

  for (const rel of rels) {
    const otherId = safeId(rel.target)
    const otherLabel = displayTarget(rel.target, nameLookup)
    lines.push(`  ${otherId}["${escLabel(otherLabel)}"]:::peer`)
    lines.push(`  ${me} -->|${escLabel(rel.displayLabel)}| ${otherId}`)
  }

  lines.push(`  classDef self fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px`)
  lines.push(`  classDef peer fill:#f9fafb,stroke:#6b7280,color:#374151`)
  return lines.join("\n")
}
