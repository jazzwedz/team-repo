// Canonical DSD structure for the agent-team pipeline.
//
// The document is split into a few coherent SECTION GROUPS, each written by
// its own specialised, trainable writer agent (section === agent, so
// per-section analyst feedback trains exactly the right agent). A panel of
// critic lenses reviews the assembled draft; a lead agent consolidates.
//
// Quick mode does NOT use this — it stays a single writer/critic/revise
// pass with the built-in prompts.

export interface DsdChapter {
  /** Stable id (used for per-chapter locking / provided content). */
  id: string
  /** `## <number>. <title>` heading used in the final document. */
  title: string
  /** What this chapter must contain (grounded in the verified facts). */
  guidance: string
}

export interface WriterGroup {
  agentId: string
  name: string
  /** One-line focus shown in the team UI and used in the prompt lead. */
  focus: string
  chapters: DsdChapter[]
}

export interface CriticLens {
  agentId: string
  name: string
  /** What this critic looks for (beyond the others). */
  focus: string
}

export const LEAD_AGENT_ID = "dsd-lead"
export const COACH_AGENT_ID = "dsd-coach"

// Ordered writer groups — modelled on real "component functional
// specification" DSDs: purpose & context → architecture → numbered
// functional requirements with traceability → data structures & NFRs →
// rules, risks & roadmap. The numbers set chapter order in the final
// document (Document History is added deterministically as chapter 1).
//
// Many chapters are grounded in the catalog facts today (rules, processes,
// flows, capabilities, NFR, data-model links). Functional Requirements,
// Data Structures and Traceability deepen further once a source-code repo
// (ADO) and the source BRD are connected — the guidance tells the writer
// to do what the facts support now and flag where depth will be added.
export const WRITER_GROUPS: WriterGroup[] = [
  {
    agentId: "dsd-writer-purpose",
    name: "Purpose & Context writer",
    focus: "why the document exists, the solution's boundaries and scope, in precise specification language",
    chapters: [
      { id: "doc-purpose", title: "2. Document Purpose", guidance: "State who the document is for (developers implementing/maintaining, testers deriving test cases, reviewers/audit). Say plainly what it describes — what the system does AND what it does not do — and whether it covers planned/target-state. Note it introduces no scope beyond the source requirements. Add a short 'Reference documentation & data model' note listing the source requirement docs and the data model it aligns to, with the caveat that those are versioned separately and changes must be re-assessed. Use only sources present in the facts; if none are given, say the references are to be linked." },
      { id: "context", title: "3. Solution Context", guidance: "Three short parts — Upstream (what feeds this solution), Downstream (what consumes it), and Responsibility Boundaries (what this solution IS responsible for and explicitly what it is NOT). Derive from the members, flows and external dependencies in the facts; do not invent systems." },
      { id: "scope", title: "4. Scope", guidance: "In scope: the member components and what they cover. Out of scope: state plainly that anything not listed is out of scope, and call out anything the facts explicitly exclude." },
    ],
  },
  {
    agentId: "dsd-writer-architecture",
    name: "Architecture writer",
    focus: "precise technical structure, strictly from the facts",
    chapters: [
      { id: "solution-architecture", title: "5. Solution Architecture", guidance: "The component inventory table (verbatim from the facts) and 2-3 sentences on how the pieces fit. Then include the architecture mermaid block from the facts verbatim." },
      { id: "capability-mapping", title: "6. Capability Mapping", guidance: "The capability mapping from the facts. Call out any GAP that needs a new component." },
    ],
  },
  {
    agentId: "dsd-writer-functional",
    name: "Functional requirements writer",
    focus: "functional behaviour as numbered, testable requirements with traceability",
    chapters: [
      { id: "traceability", title: "7. Requirements & Traceability Matrix", guidance: "A table with columns: FR id | Satisfies (capability / process / BRD section) | Status. Use the EXACT FR ids and statuses from the 'Functional requirement seeds' in the facts; keep them identical to chapter 8. Add a row for any extra FR you derived from the BRD/code." },
      { id: "functional-requirements", title: "8. Functional Requirements", guidance: "Use the 'Functional requirement seeds' in the facts: assign each its EXACT id (FR-NN) and keep ids stable across regenerations. For each: a one-line statement of what the system does, then behaviour / inputs / steps as needed, constraints, and the given status (Implemented / To be implemented). Where a seed is flagged as having AS-IS behaviour, describe AS-IS (current) vs TO-BE (target) explicitly. For formula/calculation rules, include a short worked example as an input → output table. Requirements derived from the source BRD or source code take the next free FR numbers. Do NOT invent architecture components beyond the verified facts." },
      { id: "runtime-flow", title: "9. Runtime Process Flow", guidance: "The end-to-end flow as numbered steps built from the process sequences and flows: starting event, each step (actor → target / action), and what happens on failure where known. If no sequences are modelled, derive a high-level flow from the flows, or say 'No runtime flow modelled yet.'" },
    ],
  },
  {
    agentId: "dsd-writer-data-nfr",
    name: "Data & NFR writer",
    focus: "data structures and non-functional rigor",
    chapters: [
      { id: "data-structures", title: "10. Data Structures", guidance: "For each significant data entity in the facts (data-model links, table-type members, descriptions): a column-style table (Field | Type | Description | Example) where the facts support it, plus the physical location/name if given. Where the data model is not yet linked, list the known entities and note the detailed schema will be added once the data model / source is connected. Do not invent fields." },
      { id: "nfr", title: "11. Non-Functional Requirements", guidance: "Numbered NFRs grouped by category (performance & scalability, security & data protection, audit & governance, data integrity). Use the EXACT ids from the 'Non-functional requirement seeds' in the facts (NFR-NN) and keep them stable; extra NFRs take the next free numbers. Use the NFR targets and highest data classification from the facts; note where a target is unset rather than inventing one." },
    ],
  },
  {
    agentId: "dsd-writer-rules-roadmap",
    name: "Rules & Roadmap writer",
    focus: "business rules, honest risk framing and a realistic delivery sequence",
    chapters: [
      { id: "business-rules", title: "12. Business Rules", guidance: "The business rules from the facts, each with its kind and summary. 'None captured yet.' if there are none." },
      { id: "risks", title: "13. Risks & Assumptions", guidance: "The risks from the facts, plus any explicit assumptions you make — clearly labelled as assumptions." },
      { id: "roadmap", title: "14. Implementation Roadmap", guidance: "Group the work by disposition: reuse as-is, extend, new to build. Note readiness (which members are still draft). Say plainly where you sequence beyond the data." },
      { id: "appendix", title: "15. Appendix & References", guidance: "List referenced documents, data models and external attribute specifications mentioned in the facts. 'No external references linked yet.' if none." },
    ],
  },
]

export const CRITIC_LENSES: CriticLens[] = [
  {
    agentId: "dsd-critic-grounding",
    name: "Grounding critic",
    focus: "inventions and contradictions: any component, flow, capability, NFR, risk or value not supported by the verified facts.",
  },
  {
    agentId: "dsd-critic-completeness",
    name: "Completeness critic",
    focus: "depth and breadth: thin or generic chapters, missing required chapters, facts present in the data but omitted from the document.",
  },
  {
    agentId: "dsd-critic-clarity",
    name: "Clarity critic",
    focus: "clarity and style: marketing fluff, vague sentences, inconsistent terminology, anything an analyst could not act on.",
  },
  {
    agentId: "dsd-critic-consistency",
    name: "Consistency critic",
    focus: "cross-section consistency: numbers, component names and counts that disagree between chapters or with the architecture diagram.",
  },
]

export const WRITER_IDS = WRITER_GROUPS.map((g) => g.agentId)
export const CRITIC_IDS = CRITIC_LENSES.map((c) => c.agentId)

export function groupForSection(sectionId: string): WriterGroup | undefined {
  return WRITER_GROUPS.find((g) => g.agentId === sectionId)
}

// Flat, ordered chapter list (for per-chapter "bring your own content" UI
// and the locked-content pipeline). Each entry knows its writer group.
export interface FlatChapter {
  id: string
  title: string
  guidance: string
  groupId: string
  groupName: string
}

export const ALL_CHAPTERS: FlatChapter[] = WRITER_GROUPS.flatMap((g) =>
  g.chapters.map((c) => ({ id: c.id, title: c.title, guidance: c.guidance, groupId: g.agentId, groupName: g.name }))
)

export const CHAPTER_BY_ID = new Map(ALL_CHAPTERS.map((c) => [c.id, c]))
