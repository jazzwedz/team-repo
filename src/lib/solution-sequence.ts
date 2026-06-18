// Build a mermaid `sequenceDiagram` for a solution's process sequence.
//
// Members render as `participant`, external actors as `actor` (stick
// figure). Step kinds map to arrows: sync `->>`, async `-)`, return
// `-->>`. A step with no target (or kind "note") renders as a `Note over`.
//
// Sequence diagrams have their own lexer rules — labels run to end of line —
// so this uses a dedicated escaper (NOT the flowchart escLabel).

import type { SolutionProcess } from "./types"

export type NameLookup = Map<string, string>

// Participant ids must be simple tokens.
function safeId(s: string): string {
  return (s || "").replace(/[^a-zA-Z0-9_]/g, "_") || "x"
}

// Message / participant label: collapse to a single line (mermaid reads a
// message to EOL) and neutralise characters that break the sequence lexer:
// the `;` statement separator, newlines, and `&` (mermaid treats it
// specially / chokes under securityLevel "strict"). Angle brackets are
// softened too since htmlLabels would read them as tags.
function escSeq(s: string): string {
  return (s || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/;/g, ",")
    .replace(/&/g, " and ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function buildSolutionSequenceMermaid(
  process: SolutionProcess,
  nameLookup?: NameLookup
): string {
  const lines: string[] = ["sequenceDiagram"]
  const actors = process.actors || []

  if (actors.length === 0) {
    lines.push(`  participant noop as (no actors yet)`)
    return lines.join("\n")
  }

  // Map actor.id → safe participant id, and declare each lifeline.
  const pid = new Map<string, string>()
  actors.forEach((a, i) => {
    const id = safeId(a.id || `a${i}`)
    pid.set(a.id, id)
    const label =
      (a.label && a.label.trim()) ||
      (a.component ? nameLookup?.get(a.component) || a.component : a.id) ||
      a.id
    const keyword = a.kind === "external" ? "actor" : "participant"
    lines.push(`  ${keyword} ${id} as ${escSeq(label)}`)
  })

  for (const s of process.steps || []) {
    const from = pid.get(s.from)
    if (!from) continue
    const label = escSeq(s.label) || "(step)"
    const to = s.to ? pid.get(s.to) : undefined

    if (s.kind === "note") {
      lines.push(`  Note over ${from}${to ? `,${to}` : ""}: ${label}`)
      continue
    }
    if (!to) {
      // Internal action — no target → note.
      lines.push(`  Note over ${from}: ${label}`)
      continue
    }
    const arrow = s.kind === "async" ? "-)" : s.kind === "return" ? "-->>" : "->>"
    lines.push(`  ${from}${arrow}${to}: ${label}`)
  }

  return lines.join("\n")
}
