// Component ⇄ YAML serialization — the single source of truth for how a
// component is written to disk and exported.
//
// This module is intentionally free of any server/Git dependency so it
// can run in both the API routes (src/lib/github.ts saveComponent) and
// client components (Import dialog, detail-page download, catalog
// export). It only needs js-yaml + the Component type.

import yaml from "js-yaml"
import type { Component } from "./types"

// Dump options used everywhere so on-disk YAML and exported YAML are
// byte-for-byte the same shape.
const DUMP_OPTS: yaml.DumpOptions = {
  lineWidth: -1,
  noRefs: true,
  sortKeys: false,
}

/**
 * Strip legacy fields and stamp the v2 schema_version. Idempotent.
 *
 * links[] is authoritative on disk, so the legacy edge containers
 * (interfaces / relationships / data) and the legacy capability shape
 * are dropped here. This is the single chokepoint that guarantees disk
 * (and exports) converge to v2 over time.
 */
export function normaliseForSave(component: Component): Component {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = JSON.parse(JSON.stringify(component)) as Record<string, any>
  // Drop legacy edge containers — links[] is authoritative on disk.
  delete raw.interfaces
  delete raw.relationships
  // Drop legacy data{} — every input/output now lives as a link.
  delete raw.data
  // Drop legacy capability shape.
  delete raw.business_capabilities
  // Drop empty links to keep the YAML clean.
  if (Array.isArray(raw.links) && raw.links.length === 0) delete raw.links
  raw.schema_version = 2
  return raw as Component
}

/** Serialise a single component to its canonical v2 YAML document. */
export function componentToYaml(component: Component): string {
  return yaml.dump(normaliseForSave(component), DUMP_OPTS)
}

/**
 * Serialise the whole catalog into a single round-trippable multi-doc
 * YAML bundle (`---` separated). Re-importable via the Import dialog or
 * POST /api/components/import. Round-trips through yaml.loadAll.
 */
export function catalogToYaml(components: Component[]): string {
  const header =
    `# Team Repository catalog export\n` +
    `# ${components.length} component${components.length === 1 ? "" : "s"} · schema_version 2\n`
  if (components.length === 0) return header
  return header + components.map(componentToYaml).join("---\n")
}
