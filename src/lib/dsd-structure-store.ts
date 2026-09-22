// Analyst-editable document output structure, persisted in the data repo
// (one file per document kind — see DOC_KINDS[kind].structureFile). This is
// the counterpart to the trainable agents: the agents are HOW each section
// is written; this is WHAT sections exist and what each must contain. When
// the file is absent the built-in default for that kind is used, so
// generation behaves exactly as before until an analyst fine-tunes it.
//
// A kind's writer and critic agent ids are fixed (they map to trainable
// personas); a stored structure may only edit the chapter list (add /
// remove / reorder / move between writers / edit title + guidance) and the
// descriptive name/focus text. Anything malformed is dropped so a bad file
// can never break generation.
//
// The Dsd-named exports are kept as `kind = "dsd"` wrappers for existing
// call sites; new code should use the Doc-named functions with a kind.

import yaml from "js-yaml"
import { getGit } from "./git"
import { getLogger } from "./log"
import { DOC_KINDS, type DocKind } from "./doc-kinds"
import {
  defaultStructureFor,
  writerIdsFor,
  criticIdsFor,
  type DocStructure,
  type WriterGroup,
  type CriticLens,
} from "./doc-sections"
import type { DsdChapter } from "./dsd-sections"

export type { DocStructure }

// Validate + clean an arbitrary parsed object into a structure for `kind`.
// Returns null when it isn't usable (caller falls back to the default).
function sanitize(raw: unknown, kind: DocKind): DocStructure | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as { groups?: unknown; critics?: unknown }
  if (!Array.isArray(r.groups)) return null

  const def = defaultStructureFor(kind)
  const writerIds = new Set(writerIdsFor(kind))
  const criticIds = new Set(criticIdsFor(kind))
  const defGroup = new Map(def.groups.map((g) => [g.agentId, g]))
  const seenChapterIds = new Set<string>()
  const seenGroups = new Set<string>()
  const groups: WriterGroup[] = []
  for (const g of r.groups) {
    if (!g || typeof g !== "object") continue
    const gg = g as Record<string, unknown>
    const agentId = String(gg.agentId || "")
    if (!writerIds.has(agentId) || seenGroups.has(agentId)) continue
    seenGroups.add(agentId)
    const base = defGroup.get(agentId)
    const chapters: DsdChapter[] = []
    for (const c of Array.isArray(gg.chapters) ? gg.chapters : []) {
      if (!c || typeof c !== "object") continue
      const cc = c as Record<string, unknown>
      const id = String(cc.id || "").trim()
      const title = String(cc.title || "").trim()
      const guidance = String(cc.guidance || "").trim()
      if (!id || !title || seenChapterIds.has(id)) continue
      seenChapterIds.add(id)
      chapters.push({ id, title, guidance })
    }
    groups.push({
      agentId,
      name: String(gg.name || base?.name || agentId),
      focus: String(gg.focus || base?.focus || ""),
      chapters,
    })
  }
  if (groups.length === 0) return null

  const defCritic = new Map(def.critics.map((c) => [c.agentId, c]))
  const seenCritics = new Set<string>()
  const critics: CriticLens[] = []
  for (const c of Array.isArray(r.critics) ? r.critics : []) {
    if (!c || typeof c !== "object") continue
    const cc = c as Record<string, unknown>
    const agentId = String(cc.agentId || "")
    if (!criticIds.has(agentId) || seenCritics.has(agentId)) continue
    seenCritics.add(agentId)
    const base = defCritic.get(agentId)
    critics.push({
      agentId,
      name: String(cc.name || base?.name || agentId),
      focus: String(cc.focus || base?.focus || ""),
    })
  }

  return { groups, critics: critics.length ? critics : def.critics }
}

function pathFor(kind: DocKind): string {
  return DOC_KINDS[kind].structureFile
}

export async function getDocStructure(kind: DocKind): Promise<DocStructure> {
  try {
    const file = await getGit().getFile(pathFor(kind))
    const s = sanitize(yaml.load(file.content, { schema: yaml.JSON_SCHEMA }), kind)
    if (s) return s
  } catch {
    // not committed yet → built-in default
  }
  return defaultStructureFor(kind)
}

export async function getDocStructureWithSha(
  kind: DocKind
): Promise<{ structure: DocStructure; sha?: string }> {
  try {
    const file = await getGit().getFile(pathFor(kind))
    const s = sanitize(yaml.load(file.content, { schema: yaml.JSON_SCHEMA }), kind)
    if (s) return { structure: s, sha: file.sha }
  } catch {
    // fall through to default (no sha → first save creates the file)
  }
  return { structure: defaultStructureFor(kind) }
}

export async function saveDocStructure(kind: DocKind, structure: DocStructure, sha?: string): Promise<void> {
  const clean = sanitize(structure, kind)
  if (!clean) throw new Error("Invalid structure — needs at least one writer group with chapters.")
  const content = yaml.dump(clean, { lineWidth: -1, noRefs: true, sortKeys: false })
  await getGit().putFile(pathFor(kind), content, `chore(${kind}): update output structure`, sha)
  getLogger().info("Document structure updated", {
    kind,
    groups: clean.groups.length,
    chapters: clean.groups.reduce((n, g) => n + g.chapters.length, 0),
  })
}

export async function resetDocStructure(kind: DocKind): Promise<void> {
  try {
    const file = await getGit().getFile(pathFor(kind))
    await getGit().deleteFile(pathFor(kind), file.sha, `chore(${kind}): reset output structure to defaults`)
    getLogger().info("Document structure reset to defaults", { kind })
  } catch {
    // nothing stored → already at defaults
  }
}

// ----- backwards-compatible DSD wrappers -----
export const getDsdStructure = () => getDocStructure("dsd")
export const getDsdStructureWithSha = () => getDocStructureWithSha("dsd")
export const saveDsdStructure = (structure: DocStructure, sha?: string) => saveDocStructure("dsd", structure, sha)
export const resetDsdStructure = () => resetDocStructure("dsd")
