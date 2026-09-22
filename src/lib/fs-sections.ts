// Default structure for the FS (Functional Specification) document kind.
//
// PLACEHOLDER — a sensible generic functional-specification skeleton so the
// FS pipeline works end-to-end today. It is the built-in default only; the
// analyst refines the real chapter list, titles and guidance in Settings →
// Document Output → FS (persisted to fs-structure.yaml), or this file is
// updated once the expected FS format is defined.
//
// Chapter ids `functional-requirements` and `runtime-flow` are deliberately
// the same as in the DSD: the generator keys its deterministic guarantees on
// those ids (chunked FR generation from the FR seeds; the runtime flow
// rendered from the modelled process sequences), so an FS gets them too.

import type { WriterGroup, CriticLens } from "./dsd-sections"

export const FS_LEAD_AGENT_ID = "fs-lead"
export const FS_COACH_AGENT_ID = "fs-coach"

export const FS_WRITER_GROUPS: WriterGroup[] = [
  {
    agentId: "fs-writer-purpose",
    name: "Purpose & Scope writer",
    focus: "why the specification exists, the business context, the actors and the boundaries of what is specified — in plain business language",
    chapters: [
      { id: "doc-purpose", title: "2. Document Purpose", guidance: "State who the specification is for (business owners, analysts, developers, testers) and what it specifies: what the solution must do, for whom, and what is explicitly out of its remit. Name the source requirement documents it is based on (only those present in the facts); if none, say the references are to be linked." },
      { id: "business-context", title: "3. Business Context & Scope", guidance: "The business need the solution serves (from the goal and description), the capabilities it delivers, and the in-scope / out-of-scope boundary. In scope: the member components and what they cover. Out of scope: state plainly that anything not listed is out of scope. Do not invent systems or capabilities." },
      { id: "actors", title: "4. Actors & Stakeholders", guidance: "Every human role and external system that interacts with the solution, derived from the process sequences (external actors), the flows and the external dependencies in the facts. One line each: who they are and what they need from the solution." },
    ],
  },
  {
    agentId: "fs-writer-functional",
    name: "Functional requirements writer",
    focus: "the functional behaviour as numbered, testable requirements, and the end-to-end process flows",
    chapters: [
      { id: "functional-overview", title: "5. Functional Overview", guidance: "A short narrative of what the solution does end to end, organised by capability. Reference the member components only as the parts that realise each capability; do not describe technical internals." },
      { id: "functional-requirements", title: "6. Functional Requirements", guidance: "Use the 'Functional requirement seeds' in the facts: assign each its EXACT id (FR-NN) and keep ids stable across regenerations. For each: a one-line statement of what the system must do, then behaviour / inputs / steps as needed, constraints, and the given status (Implemented / To be implemented). Where a seed is flagged as having AS-IS behaviour, describe AS-IS vs TO-BE explicitly. For calculation rules include a short worked example as an input → output table. Requirements derived from the source document take the next free FR numbers." },
      { id: "runtime-flow", title: "7. Process Flows", guidance: "The end-to-end flow as numbered steps built from the process sequences and flows: starting event, each step (actor → target / action), and what happens on failure where known. If no sequences are modelled, derive a high-level flow from the flows, or say 'No process flow modelled yet.'" },
    ],
  },
  {
    agentId: "fs-writer-data-rules",
    name: "Data, Rules & Interfaces writer",
    focus: "the data the solution handles, the business rules and calculations it enforces, and its interfaces to other systems",
    chapters: [
      { id: "data-requirements", title: "8. Data Requirements", guidance: "For each significant data entity in the facts (data-model links, table-type members, descriptions): what it is, its key fields where the facts support it (Field | Type | Description | Example), and where it is mastered. Where the data model is not linked, list the known entities and note that the detailed schema is to be added. Do not invent fields." },
      { id: "business-rules", title: "9. Business Rules & Calculations", guidance: "Every business rule and calculation from the facts, each with its kind (formula / rule / constraint), a plain-language statement and, for formulas, the expression and a worked example. Group by the component that owns the rule. 'None captured yet.' if there are none." },
      { id: "interfaces", title: "10. Interfaces & Integrations", guidance: "Each flow and external dependency from the facts as an interface: from → to, purpose, protocol, direction, and the data exchanged where known. Mark proposed (to-be) interfaces explicitly." },
    ],
  },
  {
    agentId: "fs-writer-quality",
    name: "Quality & Acceptance writer",
    focus: "non-functional expectations, acceptance criteria, traceability, and honest assumptions and open points",
    chapters: [
      { id: "nfr", title: "11. Non-Functional Requirements", guidance: "Numbered NFRs grouped by category (performance, availability, security & data protection, audit, data integrity). Use the EXACT ids from the 'Non-functional requirement seeds' in the facts (NFR-NN) and keep them stable; note where a target is unset rather than inventing one." },
      { id: "acceptance", title: "12. Acceptance Criteria & Traceability", guidance: "A table with columns: FR id | Acceptance criterion (Given / When / Then where possible) | Satisfies (capability / process / source section) | Status. Use the EXACT FR ids from chapter 6 and keep them identical." },
      { id: "assumptions", title: "13. Assumptions, Constraints & Open Points", guidance: "The risks from the facts, the assumptions you make (clearly labelled as assumptions), known constraints, and open questions the business must still answer." },
      { id: "appendix", title: "14. Appendix & References", guidance: "Referenced documents, data models and glossary terms mentioned in the facts. 'No external references linked yet.' if none." },
    ],
  },
]

export const FS_CRITIC_LENSES: CriticLens[] = [
  { agentId: "fs-critic-grounding", name: "Grounding critic", focus: "inventions and contradictions: any requirement, actor, rule, interface or value not supported by the verified facts." },
  { agentId: "fs-critic-completeness", name: "Completeness critic", focus: "depth and breadth: thin or generic chapters, missing required chapters, facts present in the data but omitted from the specification." },
  { agentId: "fs-critic-clarity", name: "Clarity critic", focus: "clarity for a business reader: technical jargon, vague or untestable requirement statements, inconsistent terminology." },
  { agentId: "fs-critic-consistency", name: "Consistency critic", focus: "cross-chapter consistency: FR ids, actor names, counts and rules that disagree between chapters or with the traceability table." },
]
