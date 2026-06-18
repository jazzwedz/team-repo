// UI block visibility — team-wide toggles for the component detail page.
//
// Each block can be hidden via `config.yaml` (ui.blocks.*) at the root of
// the data repo. Defaults to visible — when a key is missing or the file
// is absent, the block renders. A tab is considered visible when at least
// one of its blocks is visible; tabs that contain only one block become
// fully hidden when that block is toggled off.

export type DetailTabId =
  | "overview"
  /**
   * v2: the legacy "technical" and "business" tabs collapse into one.
   * The UIBlocksConfig group keys (`technical`, `business`) stay so
   * existing `config.yaml` entries keep validating — only the tab a
   * block renders on changed.
   */
  | "properties"
  | "rules"
  | "blast-radius"
  | "documentation"
  | "diagrams"
  | "history"

export interface UIBlocksConfig {
  overview?: {
    heroContext?: boolean
    details?: boolean
    descriptions?: boolean
    risks?: boolean
  }
  technical?: {
    /**
     * v2: gates the unified Links card. Renamed in the docs but the
     * key stays `relationships` so existing `config.yaml` entries
     * keep working.
     */
    relationships?: boolean
    /** @deprecated v2: Interfaces collapsed into the Links card. Field kept on the type so legacy config.yaml files still validate. */
    interfaces?: boolean
    nfr?: boolean
  }
  business?: {
    capabilities?: boolean
    /** @deprecated v2 Phase 2: Inputs & Outputs collapsed into links[]; the card is gone. */
    data?: boolean
    /** @deprecated v0.6: component-level process tags retired — a process is
     *  now the editable sequence on a solution. Field kept so existing
     *  config.yaml entries keep validating. */
    processes?: boolean
  }
  rules?: { section?: boolean }
  blastRadius?: { section?: boolean }
  documentation?: { section?: boolean }
  diagrams?: { section?: boolean }
  history?: { section?: boolean }
}

export interface BlockMeta {
  tab: DetailTabId
  group: keyof UIBlocksConfig // top-level path in UIBlocksConfig
  field: string // child key on the group object
  label: string
  description: string
}

export const BLOCK_METAS: BlockMeta[] = [
  {
    tab: "overview",
    group: "overview",
    field: "heroContext",
    label: "Hero context diagram",
    description:
      "Auto-rendered mermaid combining every link from this component to its peers.",
  },
  {
    tab: "overview",
    group: "overview",
    field: "details",
    label: "Details",
    description: "ID, type, status, owner, tags, documentation maturity bar.",
  },
  {
    tab: "overview",
    group: "overview",
    field: "descriptions",
    label: "Description",
    description:
      "Long-form description of what the component does. Legacy one-liner / technical / business fields render here too on components that have not been re-saved since v0.6.",
  },
  {
    tab: "overview",
    group: "overview",
    field: "risks",
    label: "Risks",
    description: "Known risks attached to the component.",
  },
  {
    tab: "properties",
    group: "technical",
    field: "relationships",
    label: "Links",
    description:
      "Every edge from this component to its peers — calls, serves, part-of, contains, reads-from, writes-to. Inbound rows merge in with their inverse label.",
  },
  {
    tab: "properties",
    group: "technical",
    field: "nfr",
    label: "Non-Functional Requirements",
    description:
      "Availability, RTO, RPO, latency, throughput, data classification, scaling.",
  },
  {
    tab: "properties",
    group: "business",
    field: "capabilities",
    label: "Capabilities",
    description: "Business capabilities the component plays a role in.",
  },
  {
    tab: "rules",
    group: "rules",
    field: "section",
    label: "Rules & Calculations tab",
    description: "Formulas, given-when-then rules, constraints.",
  },
  {
    tab: "blast-radius",
    group: "blastRadius",
    field: "section",
    label: "Blast Radius tab",
    description:
      "Impact graph view plus the AI-generated impact memo for management.",
  },
  {
    tab: "documentation",
    group: "documentation",
    field: "section",
    label: "Documentation tab",
    description:
      "Audience- and doctype-based document generator with PDF/ERD/BPMN attachments.",
  },
  {
    tab: "diagrams",
    group: "diagrams",
    field: "section",
    label: "Diagrams tab",
    description: "List of diagrams the component appears in.",
  },
  {
    tab: "history",
    group: "history",
    field: "section",
    label: "History tab",
    description: "Commit history for the YAML file backing the component.",
  },
]

export function isBlockVisible(
  config: UIBlocksConfig | undefined,
  group: keyof UIBlocksConfig,
  field: string
): boolean {
  const groupCfg = config?.[group] as Record<string, boolean | undefined> | undefined
  return groupCfg?.[field] !== false
}

export function isTabVisible(
  config: UIBlocksConfig | undefined,
  tab: DetailTabId
): boolean {
  return BLOCK_METAS.filter((b) => b.tab === tab).some((b) =>
    isBlockVisible(config, b.group, b.field)
  )
}
