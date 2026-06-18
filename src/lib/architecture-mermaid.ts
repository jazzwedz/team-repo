// Catalog-wide architecture overview — every component on one mermaid
// flowchart.
//
// Three edge sources can be combined or independently toggled:
//
//   - relationships  →  declared parent-of / child-of / depends-on /
//                       communicates-with / reads-from / writes-to /
//                       fallback edges, drawn as solid arrows.
//   - interfaces     →  provides / consumes edges, drawn as dotted
//                       arrows. Direction is normalised consumer →
//                       provider so that A.provides:B and B.consumes:A
//                       collapse to a single arrow B → A.
//   - data flow      →  inputs[].source and outputs[].consumers, drawn
//                       as thick arrows. A:input.source=B and
//                       B:output.consumers includes A collapse to one
//                       arrow B → A labelled with the data item name.
//
// Each node is styled by its component type using TYPE_COLORS (same
// palette as the catalog cards and the drawio export). Optional
// `groupByContainment` nests every component inside the frame of the
// thing it is `part-of` (transitively): a Context becomes a labelled
// frame holding its microservices, each of which holds its modules, and
// so on (Boundary ⊃ Context ⊃ … ⊃ Module, Database ⊃ Schema ⊃ Table).
// Containment is read from the part-of / contains link pair, so the
// part-of / contains edges themselves are not drawn (the nesting *is*
// the edge). Anything that participates in no containment falls back to
// being clustered by type.
//
// Caller is responsible for the wrapping React component; this module
// is a pure string producer.

import type { Component, SolutionMember, SolutionFlow } from "./types"
import { TYPE_COLORS, TYPE_LABELS } from "./constants"

export interface ArchitectureMermaidOptions {
  showRelationships: boolean
  showInterfaces: boolean
  /** @deprecated v2 Phase 2: data flow is now part of links[]; toggle is a no-op. */
  showDataFlow?: boolean
  /**
   * Nest components inside their container's frame (via part-of /
   * contains), falling back to type clustering for anything outside a
   * hierarchy. Replaces the old flat group-by-type behaviour.
   */
  groupByContainment: boolean
}

interface Edge {
  from: string
  to: string
  label: string
  style: "relationship" | "interface" | "data"
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_")
}

// Slice first, then map (){}[] to numeric HTML entity codes so mermaid
// doesn't lex them as structural tokens inside edge labels (a label like
// "Part of (group)" would otherwise parse-error). Slicing before escaping
// avoids cutting an entity code in half.
function escLabel(s: string): string {
  return s
    .slice(0, 80)
    .replace(/"/g, "&quot;")
    .replace(/\n/g, " ")
    .replace(/\(/g, "#40;")
    .replace(/\)/g, "#41;")
    .replace(/\[/g, "#91;")
    .replace(/\]/g, "#93;")
    .replace(/\{/g, "#123;")
    .replace(/\}/g, "#125;")
}

function typeClass(type: string): string {
  // Mermaid classDef names cannot contain hyphens, so collapse the
  // catalog's kebab-case type into a flat identifier.
  return "t" + type.replace(/[^a-zA-Z0-9]/g, "")
}

export function buildArchitectureMermaid(
  components: Component[],
  options: ArchitectureMermaidOptions
): string {
  const lines: string[] = ["flowchart LR"]

  // Empty-state guard.
  if (components.length === 0) {
    lines.push(`  noop["No components in the catalog yet"]:::muted`)
    lines.push(`  classDef muted fill:#f3f4f6,stroke:#9ca3af,color:#6b7280`)
    return lines.join("\n")
  }

  // ----- nodes -----

  const byId = new Map(components.map((c) => [c.id, c]))

  if (options.groupByContainment) {
    renderContainmentTree(components, byId, lines)
  } else {
    for (const c of components) {
      lines.push(
        `  ${safeId(c.id)}["${escLabel(c.name)}"]:::${typeClass(c.type)}`
      )
    }
  }

  // ----- edges -----

  // In containment mode the part-of / contains edges are represented by
  // the nesting itself, so they are dropped from the arrow set.
  const edges = collectEdges(components, options, options.groupByContainment)
  for (const e of edges) {
    const arrow =
      e.style === "relationship"
        ? "-->"
        : e.style === "interface"
        ? "-.->"
        : "==>"
    lines.push(
      `  ${safeId(e.from)} ${arrow}|${escLabel(e.label)}| ${safeId(e.to)}`
    )
  }

  // ----- classDefs -----

  // One classDef per type that actually appears in the catalog. Limits
  // the chart preamble even on installs with all 20 types.
  const seenTypes = new Set<string>(components.map((c) => c.type))
  for (const t of seenTypes) {
    const colors = TYPE_COLORS[t as keyof typeof TYPE_COLORS]
    if (!colors) continue
    lines.push(
      `  classDef ${typeClass(t)} fill:${colors.fill},stroke:${colors.border},color:${colors.text},stroke-width:1.5px`
    )
  }

  return lines.join("\n")
}

// Scoped diagram for a single solution: only its member components, with
// the solution's flows as edges (existing = solid, proposed = dashed).
// Reuses the same node styling as the catalog overview.
export function buildSolutionMermaid(
  members: SolutionMember[],
  components: Component[],
  flows: SolutionFlow[]
): string {
  const lines: string[] = ["flowchart LR"]

  if (!members || members.length === 0) {
    lines.push(`  noop["No members yet"]:::muted`)
    lines.push(`  classDef muted fill:#f3f4f6,stroke:#9ca3af,color:#6b7280`)
    return lines.join("\n")
  }

  const byId = new Map(components.map((c) => [c.id, c]))
  const memberIds = new Set(members.map((m) => m.component))
  const typesPresent = new Set<string>()

  for (const m of members) {
    const c = byId.get(m.component)
    const type = c?.type || "component"
    typesPresent.add(type)
    const label = c?.name || m.component
    const suffix = m.disposition === "new" ? " (new)" : m.disposition === "extend" ? " (extend)" : ""
    lines.push(
      `  ${safeId(m.component)}["${escLabel(label + suffix)}"]:::${typeClass(type)}`
    )
  }

  for (const f of flows || []) {
    if (!memberIds.has(f.from) || !memberIds.has(f.to)) continue
    if (f.from === f.to) continue
    const arrow = f.status === "proposed" ? "-.->" : "-->"
    const label = f.protocol || f.role
    lines.push(`  ${safeId(f.from)} ${arrow}|${escLabel(label)}| ${safeId(f.to)}`)
  }

  for (const t of typesPresent) {
    const colors = TYPE_COLORS[t as keyof typeof TYPE_COLORS]
    if (!colors) continue
    lines.push(
      `  classDef ${typeClass(t)} fill:${colors.fill},stroke:${colors.border},color:${colors.text},stroke-width:1.5px`
    )
  }

  return lines.join("\n")
}

// Render the catalog as nested containment frames.
//
// Containment is derived from the part-of / contains link pair:
//   - C `part-of` P            → P is C's container
//   - P `contains` C           → P is C's container (fills gaps)
// A component with ≥1 child becomes a labelled subgraph holding its
// children (recursively); a childless component is a styled node. The
// root frames are the containers with no container of their own.
// Everything that is neither contained nor a container falls back to
// being clustered by type, the same as the old group-by-type view.
function renderContainmentTree(
  components: Component[],
  byId: Map<string, Component>,
  lines: string[]
): void {
  const idSet = new Set(byId.keys())

  // child id → parent id
  const parentOf = new Map<string, string>()
  // part-of: the child names its parent (wins).
  for (const c of components) {
    for (const l of c.links || []) {
      if (
        l.role === "part-of" &&
        l.target !== c.id &&
        idSet.has(l.target) &&
        !parentOf.has(c.id)
      ) {
        parentOf.set(c.id, l.target)
      }
    }
  }
  // contains: the parent names its child — only fills gaps.
  for (const c of components) {
    for (const l of c.links || []) {
      if (
        l.role === "contains" &&
        l.target !== c.id &&
        idSet.has(l.target) &&
        !parentOf.has(l.target)
      ) {
        parentOf.set(l.target, c.id)
      }
    }
  }

  // Cycle guard: drop the parent edge of any node whose ancestry loops.
  for (const id of Array.from(parentOf.keys())) {
    const seen = new Set<string>([id])
    let cur = parentOf.get(id)
    while (cur) {
      if (seen.has(cur)) {
        parentOf.delete(id)
        break
      }
      seen.add(cur)
      cur = parentOf.get(cur)
    }
  }

  // parent id → child ids
  const childrenOf = new Map<string, string[]>()
  for (const [child, parent] of parentOf) {
    const arr = childrenOf.get(parent) || []
    arr.push(child)
    childrenOf.set(parent, arr)
  }

  const isContainer = (id: string) => (childrenOf.get(id)?.length ?? 0) > 0
  const participates = (id: string) => parentOf.has(id) || isContainer(id)

  const byName = (a: string, b: string) =>
    (byId.get(a)?.name || a).localeCompare(byId.get(b)?.name || b)

  // Subgraph `style` statements must live at the top level — emitting
  // them inside a subgraph block trips the mermaid parser. Collected
  // here and appended after the whole tree is rendered.
  const styleLines: string[] = []

  const renderNode = (id: string, indent: string) => {
    const c = byId.get(id)
    if (!c) return
    if (isContainer(id)) {
      lines.push(`${indent}subgraph ${safeId(id)} ["${escLabel(c.name)}"]`)
      const kids = (childrenOf.get(id) || []).slice().sort(byName)
      for (const k of kids) renderNode(k, indent + "  ")
      lines.push(`${indent}end`)
      const colors = TYPE_COLORS[c.type]
      if (colors) {
        styleLines.push(
          `  style ${safeId(id)} fill:${colors.fill},stroke:${colors.border},color:${colors.text}`
        )
      }
    } else {
      lines.push(
        `${indent}${safeId(id)}["${escLabel(c.name)}"]:::${typeClass(c.type)}`
      )
    }
  }

  // Root frames: participating components with no parent.
  const roots = components
    .filter((c) => participates(c.id) && !parentOf.has(c.id))
    .map((c) => c.id)
    .sort(byName)
  for (const r of roots) renderNode(r, "  ")
  lines.push(...styleLines)

  // Fallback: anything outside a hierarchy clusters by type, as before.
  const rest = components.filter((c) => !participates(c.id))
  if (rest.length > 0) {
    const byType = new Map<string, Component[]>()
    for (const c of rest) {
      const arr = byType.get(c.type) || []
      arr.push(c)
      byType.set(c.type, arr)
    }
    const types = Array.from(byType.keys()).sort((a, b) =>
      (TYPE_LABELS[a as keyof typeof TYPE_LABELS] || a).localeCompare(
        TYPE_LABELS[b as keyof typeof TYPE_LABELS] || b
      )
    )
    for (const type of types) {
      const group = (byType.get(type) || []).slice().sort((a, b) => byName(a.id, b.id))
      const groupId = `grp_${typeClass(type)}`
      const label = TYPE_LABELS[type as keyof typeof TYPE_LABELS] || type
      lines.push(`  subgraph ${groupId} ["${escLabel(label)}"]`)
      for (const c of group) {
        lines.push(
          `    ${safeId(c.id)}["${escLabel(c.name)}"]:::${typeClass(c.type)}`
        )
      }
      lines.push(`  end`)
    }
  }
}

function collectEdges(
  components: Component[],
  options: ArchitectureMermaidOptions,
  suppressContainment: boolean
): Edge[] {
  // Map keyed on canonical edge identity so A:parent-of:B + B:child-of:A
  // collapse to one entry. The first declaration wins; second is
  // dropped silently — the consistency check is the right place to
  // catch and surface duplicates.
  const seen = new Map<string, Edge>()
  const idSet = new Set(components.map((c) => c.id))

  const push = (e: Edge) => {
    // Drop edges into / out of components not in the catalog. The
    // detail page flags those as missing already; in the overview they
    // would draw arrows to nowhere.
    if (!idSet.has(e.from) || !idSet.has(e.to)) return
    if (e.from === e.to) return // self-edges add noise; skip
    const key = `${e.style}::${e.from}::${e.to}::${e.label}`
    if (!seen.has(key)) seen.set(key, e)
  }

  // v2: links[] replaces both relationships[] and interfaces[]. The
  // Relationships toggle covers `part-of` / `contains` / `reads-from`
  // / `writes-to` (structural and data-direction roles), the
  // Interfaces toggle covers `calls` / `serves` (active API edges).
  // Direction is normalised so mirror pairs collapse to one arrow.
  for (const c of components) {
    for (const link of c.links || []) {
      if (!link.target) continue

      // In containment mode the nesting represents these edges.
      if (suppressContainment && (link.role === "part-of" || link.role === "contains"))
        continue

      const isInterfaceRole = link.role === "calls" || link.role === "serves"
      const isRelationshipRole = !isInterfaceRole
      if (isInterfaceRole && !options.showInterfaces) continue
      if (isRelationshipRole && !options.showRelationships) continue

      // Direction normalisation per role:
      //   calls    — already source → target
      //   serves   — flip so caller (target) → provider (source)
      //   contains — already source → target (parent → child)
      //   part-of  — flip so parent (target) → child (source) becomes parent → child
      //   reads-from / writes-to — keep source → target literal
      let from = c.id
      let to = link.target
      let canonicalLabel = link.role
      if (link.role === "serves") {
        ;[from, to] = [to, from]
        canonicalLabel = "calls"
      } else if (link.role === "part-of") {
        ;[from, to] = [to, from]
        canonicalLabel = "contains"
      }

      const label = link.name || link.protocol || canonicalLabel
      push({
        from,
        to,
        label,
        style: isInterfaceRole ? "interface" : "relationship",
      })
    }
  }

  // v2 Phase 2: data flow now lives inside `links[]` as reads-from /
  // writes-to roles. The Relationships toggle covers both — no
  // separate Data Flow toggle.

  return Array.from(seen.values())
}
