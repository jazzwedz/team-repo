// Kind-aware accessors over the per-kind default structures.
//
// dsd-sections.ts and fs-sections.ts hold the built-in defaults for their
// kind; this module is the one place that maps a DocKind to them, so the
// store, generator, agents and UI never hard-code a kind.
//
// Client-safe: pure data, no server-only imports.

import { DOC_KINDS, type DocKind } from "./doc-kinds"
import {
  WRITER_GROUPS as DSD_WRITER_GROUPS,
  CRITIC_LENSES as DSD_CRITIC_LENSES,
  LEAD_AGENT_ID as DSD_LEAD_AGENT_ID,
  COACH_AGENT_ID as DSD_COACH_AGENT_ID,
  flatChapters,
  type DsdStructure,
  type WriterGroup,
  type CriticLens,
  type FlatChapter,
} from "./dsd-sections"
import {
  FS_WRITER_GROUPS,
  FS_CRITIC_LENSES,
  FS_LEAD_AGENT_ID,
  FS_COACH_AGENT_ID,
} from "./fs-sections"

export type { DsdStructure as DocStructure, WriterGroup, CriticLens, FlatChapter }
export { flatChapters }

const DEFAULTS: Record<DocKind, { groups: WriterGroup[]; critics: CriticLens[]; lead: string; coach: string }> = {
  dsd: { groups: DSD_WRITER_GROUPS, critics: DSD_CRITIC_LENSES, lead: DSD_LEAD_AGENT_ID, coach: DSD_COACH_AGENT_ID },
  fs: { groups: FS_WRITER_GROUPS, critics: FS_CRITIC_LENSES, lead: FS_LEAD_AGENT_ID, coach: FS_COACH_AGENT_ID },
}

export function defaultStructureFor(kind: DocKind): DsdStructure {
  return { groups: DEFAULTS[kind].groups, critics: DEFAULTS[kind].critics }
}
export function writerIdsFor(kind: DocKind): string[] {
  return DEFAULTS[kind].groups.map((g) => g.agentId)
}
export function criticIdsFor(kind: DocKind): string[] {
  return DEFAULTS[kind].critics.map((c) => c.agentId)
}
export function leadIdFor(kind: DocKind): string {
  return DEFAULTS[kind].lead
}
export function coachIdFor(kind: DocKind): string {
  return DEFAULTS[kind].coach
}
/** Flat, ordered default chapter list for a kind. */
export function allChaptersFor(kind: DocKind): FlatChapter[] {
  return flatChapters(DEFAULTS[kind].groups)
}
/** Full document title, e.g. "Detailed Solution Description". */
export function docLabel(kind: DocKind): string {
  return DOC_KINDS[kind].label
}
/** Short label, e.g. "DSD". */
export function docShort(kind: DocKind): string {
  return DOC_KINDS[kind].short
}
