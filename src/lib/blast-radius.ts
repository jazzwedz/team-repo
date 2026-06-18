import type {
  Component,
  ComponentLink,
  ComponentStatus,
  ComponentType,
  LinkRole,
} from "./types"

export type ImpactSeverity = "high" | "medium" | "low"

export interface ImpactedComponent {
  id: string
  name: string
  type: ComponentType
  status: ComponentStatus
  owner: string
  severity: ImpactSeverity
  via: {
    role: LinkRole
    protocol?: string
    description?: string
    fromComponent?: string
  }
  nfrGap: boolean
  hasConfidentialData: boolean
  depth: number
}

export interface BlastRadiusLayer {
  depth: number
  components: ImpactedComponent[]
}

export interface BlastRadiusResult {
  source: {
    id: string
    name: string
    type: ComponentType
    status: ComponentStatus
    owner: string
  }
  layers: BlastRadiusLayer[]
  totalImpacted: number
  directCount: number
  transitiveCount: number
  productionImpacted: number
  nfrGaps: number
  confidentialDataAffected: number
  mermaid: string
}

// Severity from the perspective of the SOURCE component: how badly is
// it hit when the link target goes down?
//
//   calls        — source actively calls target → HIGH (calls fail)
//   reads-from   — source reads data from target → HIGH (no data)
//   writes-to    — source writes to target → HIGH (no place to persist)
//   part-of      — source is contained in target → HIGH (container down)
//   contains     — source contains target (target is a child) → MEDIUM
//                  (parent loses a child but is usually degraded, not down)
//   serves       — source serves target (target is the caller) → LOW
//                  (target down means no caller, no functional impact)
const HIGH_IMPACT_ROLES: LinkRole[] = [
  "calls",
  "reads-from",
  "writes-to",
  "part-of",
]
const MEDIUM_IMPACT_ROLES: LinkRole[] = ["contains"]

function severityFor(role: LinkRole): ImpactSeverity {
  if (HIGH_IMPACT_ROLES.includes(role)) return "high"
  if (MEDIUM_IMPACT_ROLES.includes(role)) return "medium"
  return "low"
}

// For each component id, who declared a link pointing at it?
function buildReverseIndex(
  allComponents: Component[]
): Map<string, { from: Component; link: ComponentLink }[]> {
  const reverse = new Map<string, { from: Component; link: ComponentLink }[]>()
  for (const comp of allComponents) {
    for (const link of comp.links ?? []) {
      if (!link.target) continue
      const list = reverse.get(link.target) ?? []
      list.push({ from: comp, link })
      reverse.set(link.target, list)
    }
  }
  return reverse
}

export function computeBlastRadius(
  targetId: string,
  allComponents: Component[],
  maxDepth: number = 3
): BlastRadiusResult {
  const target = allComponents.find((c) => c.id === targetId)
  if (!target) throw new Error(`Component ${targetId} not found`)

  const reverseIndex = buildReverseIndex(allComponents)
  const componentsById = new Map(allComponents.map((c) => [c.id, c]))

  const impacted = new Map<string, ImpactedComponent>()
  const queue: { id: string; depth: number; via: ImpactedComponent["via"] }[] = []

  for (const { from, link } of reverseIndex.get(targetId) ?? []) {
    queue.push({
      id: from.id,
      depth: 1,
      via: {
        role: link.role,
        protocol: link.protocol,
        description: link.description,
      },
    })
  }

  while (queue.length > 0) {
    const item = queue.shift()!
    const { id, depth, via } = item
    if (impacted.has(id)) continue
    if (depth > maxDepth) continue
    if (id === targetId) continue
    const comp = componentsById.get(id)
    if (!comp) continue

    const isProduction = comp.status === "production"
    const hasRto = !!comp.nfr?.rto
    const hasConfidentialData =
      comp.nfr?.data_classification === "confidential" ||
      comp.nfr?.data_classification === "restricted"
    const nfrGap = isProduction && !hasRto

    impacted.set(id, {
      id: comp.id,
      name: comp.name,
      type: comp.type,
      status: comp.status,
      owner: comp.owner,
      severity: severityFor(via.role),
      via,
      nfrGap,
      hasConfidentialData,
      depth,
    })

    if (depth < maxDepth) {
      for (const { from, link } of reverseIndex.get(id) ?? []) {
        if (from.id === targetId || impacted.has(from.id)) continue
        queue.push({
          id: from.id,
          depth: depth + 1,
          via: {
            role: link.role,
            protocol: link.protocol,
            description: link.description,
            fromComponent: comp.id,
          },
        })
      }
    }
  }

  const allImpacted = Array.from(impacted.values())
  const layersMap = new Map<number, ImpactedComponent[]>()
  for (const c of allImpacted) {
    const list = layersMap.get(c.depth) ?? []
    list.push(c)
    layersMap.set(c.depth, list)
  }
  const sevOrder: Record<ImpactSeverity, number> = { high: 0, medium: 1, low: 2 }
  const layers: BlastRadiusLayer[] = Array.from(layersMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([depth, components]) => ({
      depth,
      components: components.sort((a, b) => {
        if (sevOrder[a.severity] !== sevOrder[b.severity])
          return sevOrder[a.severity] - sevOrder[b.severity]
        if (a.status !== b.status) {
          if (a.status === "production") return -1
          if (b.status === "production") return 1
        }
        return a.name.localeCompare(b.name)
      }),
    }))

  const productionImpacted = allImpacted.filter((c) => c.status === "production").length
  const nfrGaps = allImpacted.filter((c) => c.nfrGap).length
  const confidentialDataAffected = allImpacted.filter((c) => c.hasConfidentialData).length
  const directCount = layersMap.get(1)?.length ?? 0
  const transitiveCount = allImpacted.length - directCount

  return {
    source: {
      id: target.id,
      name: target.name,
      type: target.type,
      status: target.status,
      owner: target.owner,
    },
    layers,
    totalImpacted: allImpacted.length,
    directCount,
    transitiveCount,
    productionImpacted,
    nfrGaps,
    confidentialDataAffected,
    mermaid: buildMermaid(target, allImpacted),
  }
}

function sanitizeMermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_")
}

// Map (){}[] to numeric HTML entity codes so mermaid doesn't lex them as
// structural tokens inside `-->|...|` edge labels (e.g. "Part of (group)"
// would otherwise parse-error). Mermaid renders the codes back to glyphs.
function escapeLabel(s: string): string {
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

function buildMermaid(target: Component, impacted: ImpactedComponent[]): string {
  const limited = impacted.slice(0, 25)
  const lines: string[] = ["graph LR"]
  const targetId = sanitizeMermaidId(target.id)
  lines.push(`  ${targetId}["${escapeLabel(target.name)}"]:::target`)

  for (const comp of limited) {
    const compId = sanitizeMermaidId(comp.id)
    const cls =
      comp.severity === "high"
        ? ":::high"
        : comp.severity === "medium"
        ? ":::medium"
        : ""
    lines.push(`  ${compId}["${escapeLabel(comp.name)}"]${cls}`)
    const toId = comp.via.fromComponent
      ? sanitizeMermaidId(comp.via.fromComponent)
      : targetId
    lines.push(`  ${compId} -->|${comp.via.role}| ${toId}`)
  }

  lines.push(
    `  classDef target fill:#dc2626,color:#fff,stroke:#7f1d1d,stroke-width:3px`
  )
  lines.push(`  classDef high fill:#fed7aa,stroke:#ea580c,color:#7c2d12`)
  lines.push(`  classDef medium fill:#fef3c7,stroke:#ca8a04,color:#713f12`)

  return lines.join("\n")
}
