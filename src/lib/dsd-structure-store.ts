// Analyst-editable DSD output structure, persisted in the data repo as
// dsd-structure.yaml. This is the counterpart to the trainable agents: the
// agents are HOW each section is written; this is WHAT sections exist and
// what each must contain. When the file is absent the built-in default
// (DEFAULT_DSD_STRUCTURE) is used, so generation behaves exactly as before
// until an analyst fine-tunes it.
//
// The five writer agent ids and four critic agent ids are fixed (they map to
// trainable personas); a stored structure may only edit the chapter list
// (add / remove / reorder / move between writers / edit title + guidance)
// and the descriptive name/focus text. Anything malformed is dropped so a
// bad file can never break generation.

import yaml from "js-yaml"
import { getGit } from "./git"
import { getLogger } from "./log"
import {
  DEFAULT_DSD_STRUCTURE,
  WRITER_IDS,
  CRITIC_IDS,
  type DsdStructure,
  type WriterGroup,
  type CriticLens,
  type DsdChapter,
} from "./dsd-sections"

const PATH = "dsd-structure.yaml"
const WRITER_ID_SET = new Set<string>(WRITER_IDS)
const CRITIC_ID_SET = new Set<string>(CRITIC_IDS)

// Validate + clean an arbitrary parsed object into a DsdStructure. Returns
// null when it isn't usable (caller falls back to the default).
function sanitize(raw: unknown): DsdStructure | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as { groups?: unknown; critics?: unknown }
  if (!Array.isArray(r.groups)) return null

  const defGroup = new Map(DEFAULT_DSD_STRUCTURE.groups.map((g) => [g.agentId, g]))
  const seenChapterIds = new Set<string>()
  const seenGroups = new Set<string>()
  const groups: WriterGroup[] = []
  for (const g of r.groups) {
    if (!g || typeof g !== "object") continue
    const gg = g as Record<string, unknown>
    const agentId = String(gg.agentId || "")
    if (!WRITER_ID_SET.has(agentId) || seenGroups.has(agentId)) continue
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

  const defCritic = new Map(DEFAULT_DSD_STRUCTURE.critics.map((c) => [c.agentId, c]))
  const seenCritics = new Set<string>()
  const critics: CriticLens[] = []
  for (const c of Array.isArray(r.critics) ? r.critics : []) {
    if (!c || typeof c !== "object") continue
    const cc = c as Record<string, unknown>
    const agentId = String(cc.agentId || "")
    if (!CRITIC_ID_SET.has(agentId) || seenCritics.has(agentId)) continue
    seenCritics.add(agentId)
    const base = defCritic.get(agentId)
    critics.push({
      agentId,
      name: String(cc.name || base?.name || agentId),
      focus: String(cc.focus || base?.focus || ""),
    })
  }

  return { groups, critics: critics.length ? critics : DEFAULT_DSD_STRUCTURE.critics }
}

export async function getDsdStructure(): Promise<DsdStructure> {
  try {
    const file = await getGit().getFile(PATH)
    const s = sanitize(yaml.load(file.content, { schema: yaml.JSON_SCHEMA }))
    if (s) return s
  } catch {
    // not committed yet → built-in default
  }
  return DEFAULT_DSD_STRUCTURE
}

export async function getDsdStructureWithSha(): Promise<{ structure: DsdStructure; sha?: string }> {
  try {
    const file = await getGit().getFile(PATH)
    const s = sanitize(yaml.load(file.content, { schema: yaml.JSON_SCHEMA }))
    if (s) return { structure: s, sha: file.sha }
  } catch {
    // fall through to default (no sha → first save creates the file)
  }
  return { structure: DEFAULT_DSD_STRUCTURE }
}

export async function saveDsdStructure(structure: DsdStructure, sha?: string): Promise<void> {
  const clean = sanitize(structure)
  if (!clean) throw new Error("Invalid DSD structure — needs at least one writer group with chapters.")
  const content = yaml.dump(clean, { lineWidth: -1, noRefs: true, sortKeys: false })
  await getGit().putFile(PATH, content, "chore(dsd): update output structure", sha)
  getLogger().info("DSD structure updated", {
    groups: clean.groups.length,
    chapters: clean.groups.reduce((n, g) => n + g.chapters.length, 0),
  })
}

export async function resetDsdStructure(): Promise<void> {
  try {
    const file = await getGit().getFile(PATH)
    await getGit().deleteFile(PATH, file.sha, "chore(dsd): reset output structure to defaults")
    getLogger().info("DSD structure reset to defaults")
  } catch {
    // nothing stored → already at defaults
  }
}
