// -------------------------- v2 schema: ComponentLink --------------------------
//
// `links[]` replaces the legacy `interfaces[]` and `relationships[]`
// arrays. One primitive describes every edge between this component
// and another. Six roles cover the cases the old shape carried:
//
//   calls       — this actively calls / consumes from target
//                 (was: interfaces[provides=consumes], relationships[depends-on],
//                  relationships[communicates-with], relationships[fallback])
//   serves      — this exposes / provides to target
//                 (was: interfaces[provides])
//   part-of     — this is contained in target
//                 (was: relationships[child-of])
//   contains    — this contains target
//                 (was: relationships[parent-of])
//   reads-from  — this reads data from target
//                 (was: relationships[reads-from])
//   writes-to   — this writes data to target
//                 (was: relationships[writes-to])
//
// Mirror pairs (consistency check + UI dedup) — all three role pairs
// are audited; the target should declare the inverse role pointing
// back at the source (see LINK_ROLE_INVERSE in constants.ts):
//   calls       ↔ serves
//   part-of     ↔ contains
//   reads-from  ↔ writes-to    (data flow; the mirror match also
//                               requires the `name` field to agree so
//                               the data-item identity carries through)

export type LinkRole =
  | "calls"
  | "serves"
  | "part-of"
  | "contains"
  | "reads-from"
  | "writes-to"

export type LinkProtocol =
  | "rest"
  | "grpc"
  | "async"
  | "db"
  | "table"
  | "file"
  | "human"
  | "info"
  | "link"
  | "data"

// -------------------- dual-provenance: requested vs implemented --------------------
//
// The catalog is the intended (TO-BE) model; the application source code
// is the actual (AS-IS) reality. Rules, capabilities and links can carry
// two provenance facets so the two can be reconciled rather than one
// silently overwriting the other:
//
//   requested    — what the spec / BRD asked for (with its source)
//   implemented  — what the code actually does: a structured version
//                  DERIVED from the code, plus the code EVIDENCE (a
//                  citation that links to / shows the exact lines)
//
// `reconciliation` summarises how the two relate. The item's own
// top-level fields remain the canonical (published) statement; these are
// provenance layered on top, all optional and back-compatible.

/** How the requested (spec) and implemented (code) facets relate. */
export type Reconciliation =
  | "requested-only" // in the spec, not found in code (to build / gap)
  | "implemented-only" // in the code, not in the spec (undocumented)
  | "consistent" // both present and agree
  | "divergent" // both present but the code does something different

/** Where in a specification document a requested facet came from. */
export interface SpecSource {
  /** Source document name (e.g. the stored BRD). */
  doc?: string
  page?: number
  /** Verbatim passage, validated to appear in the document. */
  quote?: string
}

/** A citation into the source-code repository for an implemented facet. */
export interface CodeEvidence {
  /** File path in the source repo. */
  path: string
  lineStart?: number
  lineEnd?: number
  /** Short verbatim excerpt, validated to appear in the file. */
  snippet?: string
  /** Deep link into the source repo's web UI at this path/line. */
  url?: string
  /** Branch or commit the evidence was captured at (for honest staleness). */
  ref?: string
  /** ISO timestamp the evidence was captured. */
  capturedAt?: string
}

export interface ComponentLink {
  /** Component id OR free-form external label. */
  target: string
  role: LinkRole
  /** Optional — typically omitted for `part-of` / `contains`. */
  protocol?: LinkProtocol
  /** Short human label — e.g. "Orders API", "Stock checker". */
  name?: string
  /** What happens on this edge. */
  description?: string
  // ---- dual-provenance (optional, see Reconciliation above) ----
  /** What the spec asked for on this edge. */
  requested?: { source?: SpecSource }
  /** What the code actually does, derived + cited. */
  implemented?: { role?: LinkRole; protocol?: LinkProtocol; evidence?: CodeEvidence }
  reconciliation?: Reconciliation
}

// -------------------------- legacy shapes --------------------------

/**
 * @deprecated v2: superseded by ComponentLink with role `calls` / `serves`.
 * Read-time migration in `migrateComponent` converts every entry into
 * `links[]` and drops this field on the next save.
 */
export interface ComponentInterface {
  /**
   * Short human-readable name for the interface — e.g. "Orders API",
   * "Stock checker", "Inventory snapshot". Optional and unrestricted;
   * legacy components that have only `description` keep rendering the
   * description as the primary label so nothing on disk needs editing.
   */
  name?: string
  direction: "provides" | "consumes"
  type:
    | "rest"
    | "grpc"
    | "async"
    | "db"
    | "file"
    | "human"
    | "info"
    | "link"
    | "data"
  target?: string
  description: string
}

export type RelationshipType =
  | "parent-of"
  | "child-of"
  | "depends-on"
  | "communicates-with"
  | "reads-from"
  | "writes-to"
  | "fallback"

/**
 * @deprecated v2: superseded by ComponentLink with role mapped per
 * the table in §LinkRole above. Read-time migration converts every
 * entry into `links[]` and drops this field on the next save.
 */
export interface ComponentRelationship {
  target: string
  type: RelationshipType
  connector?:
    | "rest"
    | "grpc"
    | "async"
    | "db"
    | "file"
    | "human"
    | "info"
    | "link"
    | "data"
  description?: string
}

export interface ComponentDiagram {
  color?: string
  shape?: string
}

export interface ComponentDescription {
  /** Short one-line summary. Used as a card subtitle / hover tooltip. */
  oneliner?: string
  /**
   * Unified long-form description. This is what new components write
   * and what the UI shows. Legacy components that stored split
   * technical / business fields keep them — migrateComponent backfills
   * `description` from them at read time so the form sees one merged
   * value; on the next save the legacy fields drop and only this one
   * stays.
   */
  description?: string
  /** @deprecated use `description` instead. Read at load time only. */
  technical?: string
  /** @deprecated use `description` instead. Read at load time only. */
  business?: string
}

export type ComponentType =
  // Generic "component" — the default for new entries and a safe
  // fallback when the analyst has not yet decided what shape the thing
  // is. Listed first so it shows up at the top of the type picker.
  | "component"
  | "service"
  | "microservice"
  | "frontend"
  | "database"
  | "table"
  | "schema"
  | "queue"
  | "gateway"
  | "external"
  | "platform"
  | "library"
  | "data-pipeline"
  | "storage"
  | "batch-job"
  | "cache"
  | "context"
  | "boundary"
  | "application"
  | "module"

export type ComponentStatus = "draft" | "production" | "deprecated"

export type DataClassification = "public" | "internal" | "confidential" | "restricted"
export type ScalingModel = "horizontal" | "vertical" | "none"

export interface ComponentNFR {
  availability?: string
  rto?: string
  rpo?: string
  max_latency?: string
  throughput?: string
  data_classification?: DataClassification
  scaling?: ScalingModel
}

export type CapabilityRole = "owner" | "contributor" | "consumer" | "indirect"

export interface ComponentCapability {
  name: string
  role: CapabilityRole
  description?: string
  // ---- dual-provenance (optional) ----
  requested?: { description?: string; role?: CapabilityRole; source?: SpecSource }
  implemented?: { description?: string; role?: CapabilityRole; evidence?: CodeEvidence }
  reconciliation?: Reconciliation
}

export type DataKind =
  // Format kinds (the physical / structural shape of the artefact)
  | "table"
  | "file"
  | "stream"
  | "message"
  | "form"
  // Business kinds (semantic flow artefacts)
  | "event"
  | "command"
  | "document"
  | "decision"
  | "signal"
  // Technical kinds (state / cached / streamed)
  | "business"
  | "reference"
  | "cache"
  | "config"
  | "transient"
  | "logs"

export interface DataItem {
  name: string
  kind: DataKind
  /** Component id where this item originates (for inputs). */
  source?: string
  /** Component ids that receive this item (for outputs). */
  consumers?: string[]
  purpose?: string
  description?: string
}

export interface ComponentData {
  /** Items the component is the source-of-truth for. */
  owns?: DataItem[]
  /** Items the component receives (formerly `consumes`). */
  inputs?: DataItem[]
  /** Items the component emits (formerly `produces`). */
  outputs?: DataItem[]
}

export type ProcessRole = "owner" | "participant" | "listener" | "trigger"

export interface ComponentProcess {
  name: string
  role: ProcessRole
  /** Free-text label of what the component does in this process. */
  activity?: string
  description?: string
}

export type RuleKind = "formula" | "rule" | "constraint"

export interface ComponentRule {
  name: string
  kind: RuleKind
  /** One-line summary, applies to every kind. */
  summary?: string
  /** Optional long-form prose. */
  description?: string
  /** Used when kind === "formula" — a single expression line. */
  formula?: string
  /** Used when kind === "rule" (Given / When / Then). */
  given?: string
  when?: string
  then?: string
  /** Used when kind === "constraint" — component ids where this invariant is enforced. */
  enforced_in?: string[]
  // ---- dual-provenance (optional, see Reconciliation) ----
  /** What the spec / BRD asked for, with its source. */
  requested?: {
    summary?: string
    formula?: string
    given?: string
    when?: string
    then?: string
    source?: SpecSource
  }
  /** What the code actually does: structure derived from code + the code evidence. */
  implemented?: {
    summary?: string
    formula?: string
    given?: string
    when?: string
    then?: string
    evidence?: CodeEvidence
  }
  reconciliation?: Reconciliation
}

// Optional link to an entity in an external data model registry. Only
// meaningful on components of type `table`. The catalog stores just
// the entity name; the registry remains the source of truth for the
// attributes and relationships, which are fetched live for display.
export interface ComponentDataModelLink {
  entity: string
}

// Optional mapping to this component's source code in the configured
// source repository (Azure DevOps, read-only — see SRC_ADO_* env). Used
// as grounding for DSD generation: the listed files are read and fed to
// the writers as authoritative evidence for functional requirements,
// data structures and embedded logic. MVP reads from the single
// configured source repo; `repo` is reserved for future multi-repo
// support and is currently informational only.
export interface ComponentSource {
  repo?: string
  /** File (or directory) paths in the source repo that implement this component. */
  paths?: string[]
}

export interface Component {
  /**
   * On-disk schema version.
   *   `undefined` / `1` → legacy (interfaces + relationships authoritative).
   *   `2` → v2, links[] authoritative; legacy fields absent.
   *
   * The read-time migration in `migrateComponent` sets this to 2 in
   * memory whenever it populates `links[]`. The first save after that
   * persists v2 and drops the legacy fields from disk.
   */
  schema_version?: number
  id: string
  name: string
  type: ComponentType
  data_model?: ComponentDataModelLink
  /** Optional mapping to this component's source code (see ComponentSource). */
  source?: ComponentSource
  status: ComponentStatus
  owner: string
  tags: string[]
  description: ComponentDescription
  /** v2 — single primitive for every edge to another component. */
  links?: ComponentLink[]
  /** @deprecated v2: read-migrated to links[], dropped on next save. */
  interfaces?: ComponentInterface[]
  /** @deprecated v2: read-migrated to links[], dropped on next save. */
  relationships?: ComponentRelationship[]
  risks?: string[]
  /** @deprecated use `capabilities` (rich object) instead. Migrated at read time. */
  business_capabilities?: string[]
  capabilities?: ComponentCapability[]
  /**
   * @deprecated v2 Phase 2: `data{}` is gone. Every input/output is
   * now a link with role `reads-from` / `writes-to`, the DataItem
   * name + purpose carrying over as link.name + link.description.
   * `data.owns` is dropped entirely. Field kept on the type only so
   * legacy YAML still parses; migration drops it on read.
   */
  data?: ComponentData
  processes?: ComponentProcess[]
  rules?: ComponentRule[]
  nfr?: ComponentNFR
  diagram?: ComponentDiagram
}

export interface ComponentWithSha extends Component {
  sha: string
}

export interface Diagram {
  name: string
  content: string
}

export interface DiagramWithSha extends Diagram {
  sha: string
}

// -------------------------- Solutions --------------------------
//
// A Solution is a cross-cutting composition over existing components —
// the analyst assembles a new offering by referencing catalog
// components (many-to-many; a component can belong to many solutions),
// marking how each is used, and describing the to-be interactions.
// Stored separately from components (solutions/<id>.yaml) so the
// component catalog stays clean.

export type SolutionStatus =
  | "draft"
  | "proposed"
  | "approved"
  | "built"
  | "retired"

/** How a member component is used in the solution. */
export type MemberDisposition = "reuse" | "extend" | "new" | "external"

/** Whether a flow already exists between members or is proposed (to-be). */
export type FlowStatus = "existing" | "proposed"

export interface SolutionMember {
  /** Component id referenced from the catalog. */
  component: string
  disposition: MemberDisposition
  /** Free-text role this component plays in this solution. */
  role?: string
}

export interface SolutionFlow {
  /** Source component id (must be a member). */
  from: string
  /** Target component id (must be a member). */
  to: string
  role: LinkRole
  protocol?: LinkProtocol
  status: FlowStatus
  description?: string
}

export interface SolutionDelivers {
  capabilities?: string[]
  processes?: string[]
}

// ----- Process sequences -----
// A solution can document one or more ordered process sequences (how it
// actually runs a process), modelled as actor→target messages and rendered
// as a mermaid sequence diagram. Structure-first: this is real data (used
// for DSD grounding / AI), not a free-form drawing.

export type ProcessStepKind = "sync" | "async" | "note" | "return"

export interface ProcessActor {
  /** Stable key referenced from steps. */
  id: string
  /** Display label (for member actors, falls back to the component name). */
  label: string
  kind: "member" | "external"
  /** Set when kind === "member": catalog component id (should be a solution member). */
  component?: string
  /** Role this participant plays in the process (drives the derived registry). */
  role?: ProcessRole
}

export interface SolutionProcessStep {
  /** Initiator — a ProcessActor.id. */
  from: string
  /** Recipient — a ProcessActor.id. Omitted = internal action (rendered as a note). */
  to?: string
  /** The message / action label. */
  label: string
  description?: string
  /** Arrow style; defaults to "sync". */
  kind?: ProcessStepKind
}

export interface SolutionProcess {
  id: string
  name: string
  /** One-line purpose (optional). */
  goal?: string
  /** Optional link to a delivers.processes entry, by name. */
  deliversProcess?: string
  actors: ProcessActor[]
  steps: SolutionProcessStep[]
}

export interface Solution {
  schema_version?: number
  id: string
  name: string
  status: SolutionStatus
  owner: string
  description: ComponentDescription
  /** One-line business goal / success metric. */
  goal?: string
  delivers?: SolutionDelivers
  members?: SolutionMember[]
  flows?: SolutionFlow[]
  /** Ordered process sequences (see SolutionProcess). */
  processes?: SolutionProcess[]
  nfr?: ComponentNFR
  risks?: string[]
}

export interface SolutionWithSha extends Solution {
  sha: string
}
