// Client-safe agent display metadata. Kept separate from lib/agents.ts
// (which pulls in server-only git deps) so client components can import it.

// Where/how each agent is used in the app — shown on the Agents page so
// users understand what they're tuning. Static metadata (not persisted).
export const AGENT_USAGE: Record<string, string> = {
  "dsd-writer-purpose": "DSD generation (agent team) → writes Document Purpose, Solution Context (boundaries) & Scope.",
  "dsd-writer-architecture": "DSD generation → writes Solution Architecture & Capability Mapping.",
  "dsd-writer-functional": "DSD generation → writes Requirements & Traceability, the numbered Functional Requirements (FR-NN) & Runtime Process Flow.",
  "dsd-writer-data-nfr": "DSD generation → writes Data Structures and Non-Functional Requirements (NFR-NN).",
  "dsd-writer-rules-roadmap": "DSD generation → writes Business Rules, Risks & Assumptions, the Roadmap & Appendix.",
  "dsd-critic-grounding": "DSD generation → flags inventions/contradictions vs the verified facts.",
  "dsd-critic-completeness": "DSD generation → flags thin chapters and missing content.",
  "dsd-critic-clarity": "DSD generation → flags fluff, vague wording and inconsistent terms.",
  "dsd-critic-consistency": "DSD generation → checks numbers, names and the diagram match across sections.",
  "dsd-lead": "DSD generation → consolidates the sections into one coherent document.",
  "dsd-coach": "Agents page → turns your DSD feedback into prompt improvements you approve.",
  "fs-writer-purpose": "FS generation (agent team) → writes Document Purpose, Business Context & Scope, and Actors & Stakeholders.",
  "fs-writer-functional": "FS generation → writes the Functional Overview, the numbered Functional Requirements (FR-NN) and the Process Flows.",
  "fs-writer-data-rules": "FS generation → writes Data Requirements, Business Rules & Calculations, and Interfaces & Integrations.",
  "fs-writer-quality": "FS generation → writes Non-Functional Requirements (NFR-NN), Acceptance Criteria & Traceability, Assumptions and the Appendix.",
  "fs-critic-grounding": "FS generation → flags inventions/contradictions vs the verified facts.",
  "fs-critic-completeness": "FS generation → flags thin chapters and missing content.",
  "fs-critic-clarity": "FS generation → flags jargon, vague or untestable requirement statements and inconsistent terms.",
  "fs-critic-consistency": "FS generation → checks FR ids, actor names and counts match across chapters.",
  "fs-lead": "FS generation → consolidates the sections into one coherent specification.",
  "fs-coach": "Agents page → turns your FS feedback into prompt improvements you approve.",
  "solution-composer": "Solution composer (/solutions/new) → ‘Pre-fill with AI’ proposes the skeleton.",
  "rules-locator": "Rules import (on a component) → finds the passages that carry business rules.",
  "rules-extractor": "Rules import (on a component) → extracts the structured rules from those passages.",
  "doc-writer": "Document generation (/generate) → writes component & diagram documents.",
  "process-drafter": "Process sequences (on a solution) → ‘AI draft’ proposes a sequence.",
  "catalog-enricher": "Enrich from DSD (on a solution) → proposes improved component descriptions, capabilities & rules from the sources, for your approval.",
  "relationship-auditor": "Consistency check (catalog) → ‘Find missing relationships’ infers links that should exist but neither component declares, with a confidence & rationale, for your approval.",
  "catalog-curator": "Curate from document (catalog) → reads an uploaded PDF and proposes Add/Update/Conflict changes to existing components (description, capabilities, rules) with a page-cited quote, confidence & rationale, for your approval. Learns from your 👍/👎 feedback.",
  "code-rule-auditor": "Check rules against code (on a component) → reads the component's mapped source files and fills each rule's ‘implemented’ facet (derived structure + cited code), flags consistent/divergent/requested-only and surfaces undocumented rules, for your approval.",
  "source-mapper": "Find source files (on a component) → scans the connected source repo and proposes which files implement the component (so you don't have to know the code layout), filling source.paths on your approval.",
}
