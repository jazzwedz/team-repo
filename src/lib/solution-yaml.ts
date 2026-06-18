// Solution ⇄ YAML serialization — mirror of component-yaml.ts.
//
// Server/Git-free so it can run in API routes and (future) client code.
// Only js-yaml + the Solution type.

import yaml from "js-yaml"
import type { Solution } from "./types"

const DUMP_OPTS: yaml.DumpOptions = {
  lineWidth: -1,
  noRefs: true,
  sortKeys: false,
}

/** Drop empty collections and stamp schema_version. Idempotent. */
export function normaliseSolutionForSave(solution: Solution): Solution {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = JSON.parse(JSON.stringify(solution)) as Record<string, any>
  if (Array.isArray(raw.members) && raw.members.length === 0) delete raw.members
  if (Array.isArray(raw.flows) && raw.flows.length === 0) delete raw.flows
  if (Array.isArray(raw.processes) && raw.processes.length === 0) delete raw.processes
  if (Array.isArray(raw.risks) && raw.risks.length === 0) delete raw.risks
  if (raw.delivers) {
    const d = raw.delivers
    if (Array.isArray(d.capabilities) && d.capabilities.length === 0) delete d.capabilities
    if (Array.isArray(d.processes) && d.processes.length === 0) delete d.processes
    if (Object.keys(d).length === 0) delete raw.delivers
  }
  raw.schema_version = 1
  return raw as Solution
}

export function solutionToYaml(solution: Solution): string {
  return yaml.dump(normaliseSolutionForSave(solution), DUMP_OPTS)
}

/** Multi-doc bundle of all solutions (`---` separated), round-trippable. */
export function catalogSolutionsToYaml(solutions: Solution[]): string {
  const header =
    `# Team Repository solutions export\n` +
    `# ${solutions.length} solution${solutions.length === 1 ? "" : "s"} · schema_version 1\n`
  if (solutions.length === 0) return header
  return header + solutions.map(solutionToYaml).join("---\n")
}
