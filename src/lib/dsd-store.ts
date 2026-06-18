// DSD artifact store — generated Detailed Solution Descriptions are
// persisted to the data repo as markdown files with a YAML front-matter
// metadata block, under dsd/<solutionId>/<artifactId>.md. Each is one
// commit, so the DSD library is versioned and auditable like everything
// else in arch-tool. Routed through the same GitProvider (getGit).

import yaml from "js-yaml"
import { getGit, GitNotFoundError } from "./git"
import { getLogger } from "./log"

export type DsdMode = "quick" | "team"

export interface DsdFeedback {
  /** Stable id so the coach can mark it consumed. */
  id?: string
  rating: "up" | "down"
  comment?: string
  /** Optional analyst-corrected version (gold training signal). */
  correctedText?: string
  /** Section group this feedback is about (a writer agentId). Omitted =
   *  whole-document feedback. Lets the coach train the exact agent. */
  section?: string
  at: string
  by?: string
  /** True once a coach proposal built from it was approved or rejected. */
  resolved?: boolean
}

/** A section group of a DSD (one writer agent's output). `body` is only
 *  used in-memory during generation; the persisted artifact stores just
 *  id+title (the full text already lives in the markdown body). */
export interface DsdSection {
  /** Writer group agentId (e.g. dsd-writer-architecture). */
  id: string
  title: string
  body?: string
}

/** Where a DSD has been published in Confluence. One-way publish: the
 *  tool pushes the markdown up and remembers the page + chosen parent so
 *  re-publishing updates the same page and pre-selects the parent. */
export interface DsdConfluenceLink {
  pageId: string
  pageUrl: string
  /** Parent page the DSD was published under (the "sub-directory"). */
  parentId?: string | null
  parentTitle?: string
  /** Numeric space id (cloud) or space key (data center). */
  spaceId?: string
  /** Last published Confluence version number. */
  version?: number
  publishedAt: string
}

export interface DsdArtifactMeta {
  id: string
  solutionId: string
  title: string
  mode: DsdMode
  model?: string
  createdAt: string
  /** team mode: which agent versions produced it. */
  agentVersions?: Record<string, number>
  iterations?: number
  /** team mode: the section groups (writer outputs) for per-section feedback. */
  sections?: DsdSection[]
  /** team mode: chapter ids the analyst provided verbatim (locked). */
  lockedChapters?: string[]
  /** Name of the source requirements document (BRD) used as grounding, if any. */
  sourceDocName?: string
  /** Set true once an analyst has hand-edited the generated markdown. */
  edited?: boolean
  editedAt?: string
  feedback?: DsdFeedback[]
  /** Set once the DSD has been published to Confluence. */
  confluence?: DsdConfluenceLink
}

export interface DsdArtifact extends DsdArtifactMeta {
  markdown: string
  sha?: string
}

const SAFE_ARTIFACT_ID = /^[A-Za-z0-9_-]+$/

function dirFor(solutionId: string): string {
  return `dsd/${solutionId}/`
}
function pathFor(solutionId: string, artifactId: string): string {
  return `dsd/${solutionId}/${artifactId}.md`
}

/** Filesystem-safe, sortable artifact id from the current time. */
export function newArtifactId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function serialize(meta: DsdArtifactMeta, markdown: string): string {
  const fm = yaml.dump(meta, { lineWidth: -1, noRefs: true, sortKeys: false })
  return `---\n${fm}---\n\n${markdown.trim()}\n`
}

function parse(content: string): { meta: Partial<DsdArtifactMeta>; markdown: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return { meta: {}, markdown: content }
  let meta: Partial<DsdArtifactMeta> = {}
  try {
    meta = (yaml.load(m[1], { schema: yaml.JSON_SCHEMA }) as Partial<DsdArtifactMeta>) || {}
  } catch {
    meta = {}
  }
  return { meta, markdown: content.slice(m[0].length).trimStart() }
}

/** List artifact metadata for a solution (newest first), without bodies. */
export async function listDsd(solutionId: string): Promise<DsdArtifactMeta[]> {
  const git = getGit()
  let entries: { path: string; sha: string }[]
  try {
    entries = await git.listTree(dirFor(solutionId))
  } catch {
    return []
  }
  const files = entries.filter((e) => e.path.endsWith(".md"))
  const metas = await Promise.all(
    files.map(async (f) => {
      try {
        const content = await git.getBlob(f.sha)
        const { meta } = parse(content)
        return meta.id ? (meta as DsdArtifactMeta) : null
      } catch (err) {
        getLogger().error(`Failed to read DSD ${f.path}`, {
          err: err instanceof Error ? err.message : String(err),
        })
        return null
      }
    })
  )
  return (metas.filter(Boolean) as DsdArtifactMeta[]).sort((a, b) =>
    (b.createdAt || "").localeCompare(a.createdAt || "")
  )
}

export async function getDsd(solutionId: string, artifactId: string): Promise<DsdArtifact> {
  if (!SAFE_ARTIFACT_ID.test(artifactId)) throw new GitNotFoundError("Invalid artifact id")
  const git = getGit()
  const file = await git.getFile(pathFor(solutionId, artifactId))
  const { meta, markdown } = parse(file.content)
  return { ...(meta as DsdArtifactMeta), markdown, sha: file.sha }
}

export async function saveDsd(meta: DsdArtifactMeta, markdown: string): Promise<void> {
  const git = getGit()
  const content = serialize(meta, markdown)
  await git.putFile(
    pathFor(meta.solutionId, meta.id),
    content,
    `docs: add DSD ${meta.id} for ${meta.solutionId}`
  )
}

// Rebuild the "## Table of Contents" list from the current H2 headings so it
// stays derived even after an analyst edits the body. Skips headings inside
// fenced code blocks and the TOC heading itself. No-op when there is no TOC
// block (e.g. the analyst removed it) or no headings.
function regenerateToc(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  let inFence = false
  const headings: string[] = []
  for (const l of lines) {
    if (/^```/.test(l.trim())) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = l.match(/^##\s+(.+?)\s*$/)
    if (m && !/^table of contents$/i.test(m[1].trim())) headings.push(m[1].trim())
  }
  if (!headings.length) return markdown
  const list = headings.map((h) => `- ${h}`).join("\n")
  return markdown.replace(
    /(^##\s+Table of Contents[ \t]*\r?\n)[\s\S]*?(?=\r?\n#{1,2}\s)/im,
    `$1${list}\n`
  )
}

/** Rename a DSD artifact (metadata only; body unchanged). */
export async function renameDsd(
  solutionId: string,
  artifactId: string,
  title: string
): Promise<void> {
  if (!SAFE_ARTIFACT_ID.test(artifactId)) throw new GitNotFoundError("Invalid artifact id")
  const trimmed = title.trim()
  if (!trimmed) throw new Error("Title cannot be empty")
  const git = getGit()
  const file = await git.getFile(pathFor(solutionId, artifactId))
  const { meta, markdown } = parse(file.content)
  const m = meta as DsdArtifactMeta
  m.title = trimmed
  await git.putFile(
    pathFor(solutionId, artifactId),
    serialize(m, markdown),
    `docs: rename DSD ${artifactId} to "${trimmed}"`,
    file.sha
  )
}

/** Persist an analyst-edited DSD body, marking it edited and re-deriving the
 *  table of contents. The body is otherwise saved verbatim. */
export async function updateDsdMarkdown(
  solutionId: string,
  artifactId: string,
  markdown: string,
  by?: string
): Promise<void> {
  if (!SAFE_ARTIFACT_ID.test(artifactId)) throw new GitNotFoundError("Invalid artifact id")
  const git = getGit()
  const file = await git.getFile(pathFor(solutionId, artifactId))
  const { meta } = parse(file.content)
  const m = meta as DsdArtifactMeta
  m.edited = true
  m.editedAt = new Date().toISOString()
  const nextMarkdown = regenerateToc(markdown.trim())
  await git.putFile(
    pathFor(solutionId, artifactId),
    serialize(m, nextMarkdown),
    `docs: edit DSD ${artifactId} for ${solutionId}${by ? ` (${by})` : ""}`,
    file.sha
  )
}

export async function deleteDsd(solutionId: string, artifactId: string): Promise<void> {
  if (!SAFE_ARTIFACT_ID.test(artifactId)) throw new GitNotFoundError("Invalid artifact id")
  const git = getGit()
  const file = await git.getFile(pathFor(solutionId, artifactId))
  await git.deleteFile(
    pathFor(solutionId, artifactId),
    file.sha,
    `docs: remove DSD ${artifactId} for ${solutionId}`
  )
}

/** Persist (or clear) the Confluence link on an artifact after a publish. */
export async function setDsdConfluence(
  solutionId: string,
  artifactId: string,
  link: DsdConfluenceLink
): Promise<void> {
  if (!SAFE_ARTIFACT_ID.test(artifactId)) throw new GitNotFoundError("Invalid artifact id")
  const git = getGit()
  const file = await git.getFile(pathFor(solutionId, artifactId))
  const { meta, markdown } = parse(file.content)
  const m = meta as DsdArtifactMeta
  m.confluence = link
  await git.putFile(
    pathFor(solutionId, artifactId),
    serialize(m, markdown),
    `docs: link DSD ${artifactId} to Confluence ${link.pageId}`,
    file.sha
  )
}

export async function addFeedback(
  solutionId: string,
  artifactId: string,
  feedback: DsdFeedback
): Promise<void> {
  if (!SAFE_ARTIFACT_ID.test(artifactId)) throw new GitNotFoundError("Invalid artifact id")
  const git = getGit()
  const file = await git.getFile(pathFor(solutionId, artifactId))
  const { meta, markdown } = parse(file.content)
  const m = meta as DsdArtifactMeta
  m.feedback = [...(m.feedback || []), feedback]
  await git.putFile(
    pathFor(solutionId, artifactId),
    serialize(m, markdown),
    `docs: feedback on DSD ${artifactId}`,
    file.sha
  )
}

