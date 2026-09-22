// Document kinds the tool can generate for a solution.
//
// Every generated document type (today: DSD and FS) shares the same
// machinery — an editable chapter structure, a trainable agent team
// (writers / critics / lead / coach), grounded generation, an artifact
// library with feedback, and Confluence publishing. This registry is the
// single place that names a kind and where its pieces live, so adding a
// new kind means: add an entry here + a default structure module.
//
// Client-safe: no server-only imports.

export type DocKind = "dsd" | "fs"

export interface DocKindDef {
  id: DocKind
  /** Full name, e.g. "Detailed Solution Description". */
  label: string
  /** Short label used in UI badges and titles, e.g. "DSD". */
  short: string
  /** Agent id prefix: `${prefix}-writer-*`, `${prefix}-critic-*`, `${prefix}-lead`, `${prefix}-coach`. */
  agentPrefix: string
  /** Analyst-editable structure file in the data repo. */
  structureFile: string
  /** Directory in the data repo holding generated artifacts: `<dir>/<solutionId>/<artifactId>.md`. */
  artifactDir: string
  /** Data-repo file holding the coach's training watermark for this kind. */
  coachStateFile: string
  /** One-line description shown in Settings and on the solution page. */
  description: string
}

export const DOC_KINDS: Record<DocKind, DocKindDef> = {
  dsd: {
    id: "dsd",
    label: "Detailed Solution Description",
    short: "DSD",
    agentPrefix: "dsd",
    structureFile: "dsd-structure.yaml",
    artifactDir: "dsd",
    coachStateFile: "agents/_coach-state.yaml",
    description:
      "Technical solution design — architecture, numbered functional requirements with traceability, data structures, NFRs, rules and roadmap.",
  },
  fs: {
    id: "fs",
    label: "Functional Specification",
    short: "FS",
    agentPrefix: "fs",
    structureFile: "fs-structure.yaml",
    artifactDir: "fs",
    coachStateFile: "agents/_coach-state-fs.yaml",
    description:
      "Functional requirements specification in the use-case format — document control, introduction & scope, numbered use cases with process flows and management-rules tables, the rules register, data, interfaces, NFRs, acceptance criteria and an open-points register.",
  },
}

export const DOC_KIND_IDS = Object.keys(DOC_KINDS) as DocKind[]

export function isDocKind(x: unknown): x is DocKind {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(DOC_KINDS, x)
}

/** Which kind an agent id belongs to (by prefix), or undefined for assistants. */
export function docKindOfAgent(agentId: string): DocKind | undefined {
  for (const k of DOC_KIND_IDS) {
    if (agentId.startsWith(`${DOC_KINDS[k].agentPrefix}-`)) return k
  }
  return undefined
}
