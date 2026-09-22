// Default structure for the FS (Functional Specification) document kind.
//
// Modelled on real "functional requirements analysis" documents: a document
// control block, an introduction (demand → objective → business overview →
// scope), then the functional requirement specification as numbered USE
// CASES — each with its use-case table, its process flow and its table of
// numbered management rules — followed by the rules register, data,
// interfaces, NFRs, acceptance criteria and an open-points register.
//
// It keeps the recognisable shape analysts and developers work from (use
// case tables, RG-numbered rules, screen/messages notes, a technical part)
// and fixes what such documents typically get wrong: unique UC / RG / AC
// ids, an explicit in/out-of-scope boundary, one authoritative statement
// per rule, no empty template sections, concrete acceptance criteria, and
// an open-points register for every value business still has to supply.
//
// Chapter 1 (Document Control) is rendered deterministically. The
// `use-cases` chapter is generated in bounded chunks from the stable
// use-case / management-rule seeds (see fs-usecases.ts) so every modelled
// process becomes a use case; the analyst refines everything else in
// Settings → Document Output → FS (persisted to fs-structure.yaml).

import type { WriterGroup, CriticLens } from "./dsd-sections"

export const FS_LEAD_AGENT_ID = "fs-lead"
export const FS_COACH_AGENT_ID = "fs-coach"

export const FS_WRITER_GROUPS: WriterGroup[] = [
  {
    agentId: "fs-writer-purpose",
    name: "Introduction & Scope writer",
    focus: "the demand, its objective, the business overview of the change, the in/out-of-scope boundary, the actors and the glossary — in plain business language",
    chapters: [
      {
        id: "introduction",
        title: "2. Introduction",
        guidance:
          "Three sub-sections. **2.1 Overview of the demand** — what change or solution is being specified, which systems (the member components) it impacts and how, and the history of the current systems where the facts give AS-IS behaviour (members with disposition extend or reuse). **2.2 Objective and summary** — the business objectives as 'who … should be able to … so that …' bullets, derived from the goal, the description and the capabilities; then how the specification is organised (which use cases cover which objective, by UC id from the use-case seeds). **2.3 Business overview of the change** — a table Feature | Carried by (component) | Priority with one row per feature the change contains, derived from the capabilities, processes and rules in the facts; include the Priority column only if the facts state priorities. Never leave a sub-section empty: if the facts give nothing for it, write one sentence saying what is missing and who must supply it.",
      },
      {
        id: "scope",
        title: "3. Scope",
        guidance:
          "**In scope** — an explicit bullet list: the member components and the features / use cases they carry (reference UC ids). **Out of scope** — an explicit bullet list of what is NOT covered: systems the members depend on that are external to the solution (from the External dependencies), and anything the facts explicitly exclude; end with 'Anything not listed above is out of scope.' An item must never appear in both lists and never conditionally ('if not done in this release'). **Constraints** — release, product-version, data or integration constraints the facts state; 'None stated.' if there are none.",
      },
      {
        id: "actors-glossary",
        title: "4. Actors, Stakeholders & Glossary",
        guidance:
          "**Actors** — a table Actor | Type (user role / member system / external system) | Role in the solution, with one row for every process participant and every external dependency in the facts. **Stakeholders** — a table Role | Responsibility: the solution owner, plus other roles only if the facts name them. **Glossary** — a table Term | Definition for the domain terms and abbreviations the specification actually uses (component names, capability names, rule names, statuses). Never leave a table empty — if there are no special terms, say so in one line.",
      },
    ],
  },
  {
    agentId: "fs-writer-functional",
    name: "Use-case writer",
    focus: "the functional requirement specification as numbered use cases — each with its use-case table, its process flow and its table of numbered management rules",
    chapters: [
      {
        id: "use-cases",
        title: "5. Use Cases",
        guidance:
          "The functional requirement specification. One sub-section per use case from the 'Use case seeds' in the facts, in seed order, headed '### UC-NN — <name>' with the seed's EXACT id. Each sub-section has, in this order: (a) the use-case table (two columns, one row per field): Use case ID | Name | Principal actor | Components involved | Description | Trigger | Pre-conditions (numbered) | Post-conditions (numbered) | Status — every cell filled from the facts, never '(empty)' or 'TBD'; (b) **Process flow** — the numbered actor → target steps of the modelled process sequence with its sequence diagram; (c) **Management rules** — a table N° | Rule | Source listing the RG ids from the 'Management rule seeds' that apply in this use case, each stated in ONE testable sentence (the full statement, formula and worked example belong in chapter 6 — do not restate them differently here); (d) **User interface & messages** — screens, fields, labels and error messages only where the facts or the source document specify them; otherwise one line 'No screen change specified.' Use-case ids are unique; cross-reference only by 'UC-NN' and 'RG-NN'. Rules that apply in no use case go into a final '### General management rules' table. If no process is modelled, derive the use cases from the features and rules in the facts and say so.",
      },
    ],
  },
  {
    agentId: "fs-writer-data-rules",
    name: "Rules, Data & Interfaces writer",
    focus: "the single authoritative statement of every management rule and calculation, the business objects and fields the change touches, and its interfaces, batches, notifications and reports",
    chapters: [
      {
        id: "business-rules",
        title: "6. Management Rules & Calculations",
        guidance:
          "The single authoritative statement of every rule. One entry per RG id from the 'Management rule seeds', in seed order: '### RG-NN — <rule name>', then: Kind (formula / rule / constraint); Owning component; Applies in (UC ids); the Statement — for a formula the expression exactly as given plus a worked example as an input → output table, for a rule its Given / When / Then, for a constraint the invariant and where it is enforced; Status (Implemented / To be implemented) and, where the seed is flagged AS-IS, AS-IS vs TO-BE. Rules derived from the source document take the next free RG numbers and cite the passage. State each rule ONCE — never two differently-worded versions of the same rule. Where a value the rule needs is not in the facts (a threshold, a weight, a table of values), write 'value to be provided by business' and list it as an open point in chapter 11; never invent it. 'No management rules captured yet.' if there are none.",
      },
      {
        id: "data-requirements",
        title: "7. Data Requirements",
        guidance:
          "The business objects the change creates or adapts. For each object: '### <Object>' then a table Property | Type | Mandatory | Size / allowed values | Mastered in — from the data-model evidence, table-type members and rule inputs in the facts; mark new or changed properties. Then **Field mapping** where the facts support it: Field | Origin (component / entity) | Type | Rule. Do not invent fields; where the data model is not linked, list the known objects and note that the detailed schema is to be added.",
      },
      {
        id: "interfaces",
        title: "8. Interfaces, Batches & Notifications",
        guidance:
          "**Interfaces** — a table Transfer (business object) | From → To | Direction | Transfer mode / protocol | Frequency | Trigger | Status, one row per flow and external dependency in the facts; where two integration options are left open, present neither as the specification — state the open decision and list it in chapter 11. **Batches** — scheduled processing the facts describe (name, schedule, input, output). **Notifications** — Event | Message | Recipient | Channel. **Print & reports** — documents, lists or reports to be created or changed: Report / list | Filters | Columns (Field | Origin | Type) | Author groups. Under any heading the facts do not support write 'None specified.' — never leave it empty.",
      },
    ],
  },
  {
    agentId: "fs-writer-quality",
    name: "Quality & Acceptance writer",
    focus: "non-functional requirements, concrete acceptance criteria, and an honest register of decisions, assumptions and open points",
    chapters: [
      {
        id: "nfr",
        title: "9. Non-Functional Requirements",
        guidance:
          "Numbered NFRs grouped by category (performance, availability, security & data protection, audit trail & history, data integrity, data retention). Use the EXACT ids from the 'Non-functional requirement seeds' in the facts (NFR-NN) and keep them stable; extra NFRs take the next free numbers. State each NFR as a testable statement; note where a target is unset rather than inventing one. Under security & data protection cover who may see or change what, per the rights the rules mention, and data retention where personal data is handled.",
      },
      {
        id: "acceptance",
        title: "10. Acceptance Criteria",
        guidance:
          "Concrete, testable criteria — never a single sentence such as 'all topics tested'. A table Id | Use case | Given / When / Then | Verifies (RG / NFR ids) | Status, with ids AC-NN numbered in use-case order: at least one criterion per use case, one per management rule that changes behaviour, and one for every validation / closing control and every access-rights rule. Use the EXACT UC, RG and NFR ids from the other chapters.",
      },
      {
        id: "open-points",
        title: "11. Assumptions, Decisions & Open Points",
        guidance:
          "**Decisions** — a table Decision | Rationale | Decided by, from the facts only (an option still open is NOT a decision). **Open points** — a register N° | Open point | Needed for (UC / RG) | Owner | Needed by | Status: every value 'to be provided by business', every unresolved option, every missing label, message or translation text, and every gap the facts leave. **Assumptions** — clearly labelled as assumptions. **Risks** — the risks from the facts. 'None.' under a heading with nothing to list.",
      },
      {
        id: "appendix",
        title: "12. Appendix & References",
        guidance:
          "**Referred documents** — a table N° | Document | Version | Date for the source requirement document, data models and external specifications named in the facts ('No external references linked yet.' if none). **System context** — the architecture mermaid block from the facts verbatim, as the figure showing the members and their flows.",
      },
    ],
  },
]

export const FS_CRITIC_LENSES: CriticLens[] = [
  {
    agentId: "fs-critic-grounding",
    name: "Grounding critic",
    focus: "inventions and contradictions: any use case, actor, rule, value, threshold, field or interface not supported by the verified facts.",
  },
  {
    agentId: "fs-critic-completeness",
    name: "Completeness critic",
    focus: "empty or template-only sections (a heading with nothing under it is a defect), processes without a use case, rules without an RG entry, use cases without acceptance criteria, missing pre- or post-conditions.",
  },
  {
    agentId: "fs-critic-clarity",
    name: "Clarity critic",
    focus: "clarity for a business reader and a tester: vague or untestable statements, options left open as if they were the specification, the same rule stated twice in different words, unexplained jargon.",
  },
  {
    agentId: "fs-critic-consistency",
    name: "Consistency critic",
    focus: "UC / RG / NFR / AC ids unique and identical across chapters; scope, use cases, the rules register and the acceptance criteria agree with each other and with the facts.",
  },
]
