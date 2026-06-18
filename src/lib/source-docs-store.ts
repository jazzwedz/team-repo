// Source documents (BRD / spec) attached to a solution.
//
// Stored as sidecar files in the data repo under
// source-docs/<solutionId>/<docId>.md — markdown body (the extracted plain
// text) with a small YAML front-matter. Kept OUT of the solution YAML so
// listing solutions stays light; the (potentially large) text is fetched
// only when needed (DSD generation, re-download). Uploaded once and reused
// by both the solution composer and DSD generation.

import yaml from "js-yaml"
import { getGit, GitNotFoundError } from "./git"
import { getLogger } from "./log"

export interface SourceDocMeta {
  id: string
  name: string
  createdAt: string
  chars: number
}

export interface SourceDoc extends SourceDocMeta {
  text: string
  sha?: string
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/

function dirFor(solutionId: string): string {
  return `source-docs/${solutionId}/`
}
function pathFor(solutionId: string, docId: string): string {
  return `source-docs/${solutionId}/${docId}.md`
}

export function newSourceDocId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

interface StoredMeta {
  id: string
  name: string
  createdAt: string
}

function serialize(meta: StoredMeta, text: string): string {
  const fm = yaml.dump(meta, { lineWidth: -1, noRefs: true, sortKeys: false })
  return `---\n${fm}---\n\n${text.trim()}\n`
}

function parse(content: string): { meta: Partial<StoredMeta>; text: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return { meta: {}, text: content }
  let meta: Partial<StoredMeta> = {}
  try {
    meta = (yaml.load(m[1], { schema: yaml.JSON_SCHEMA }) as Partial<StoredMeta>) || {}
  } catch {
    meta = {}
  }
  return { meta, text: content.slice(m[0].length).trimStart() }
}

/** List stored source-doc metadata for a solution (newest first), no bodies. */
export async function listSourceDocs(solutionId: string): Promise<SourceDocMeta[]> {
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
        const { meta, text } = parse(content)
        if (!meta.id) return null
        return {
          id: meta.id,
          name: meta.name || meta.id,
          createdAt: meta.createdAt || "",
          chars: text.length,
        } as SourceDocMeta
      } catch (err) {
        getLogger().error(`Failed to read source doc ${f.path}`, {
          err: err instanceof Error ? err.message : String(err),
        })
        return null
      }
    })
  )
  return (metas.filter(Boolean) as SourceDocMeta[]).sort((a, b) =>
    (b.createdAt || "").localeCompare(a.createdAt || "")
  )
}

export async function getSourceDoc(solutionId: string, docId: string): Promise<SourceDoc> {
  if (!SAFE_ID.test(docId)) throw new GitNotFoundError("Invalid source doc id")
  const git = getGit()
  const file = await git.getFile(pathFor(solutionId, docId))
  const { meta, text } = parse(file.content)
  return {
    id: meta.id || docId,
    name: meta.name || docId,
    createdAt: meta.createdAt || "",
    chars: text.length,
    text,
    sha: file.sha,
  }
}

export async function saveSourceDoc(
  solutionId: string,
  input: { name: string; text: string }
): Promise<SourceDocMeta> {
  const git = getGit()
  const id = newSourceDocId()
  const meta: StoredMeta = {
    id,
    name: input.name?.trim() || "source document",
    createdAt: new Date().toISOString(),
  }
  await git.putFile(
    pathFor(solutionId, id),
    serialize(meta, input.text),
    `docs: add source document ${id} for ${solutionId}`
  )
  return { ...meta, chars: input.text.length }
}

export async function deleteSourceDoc(solutionId: string, docId: string): Promise<void> {
  if (!SAFE_ID.test(docId)) throw new GitNotFoundError("Invalid source doc id")
  const git = getGit()
  const file = await git.getFile(pathFor(solutionId, docId))
  await git.deleteFile(
    pathFor(solutionId, docId),
    file.sha,
    `docs: remove source document ${docId} for ${solutionId}`
  )
}

/** Concatenated text of all stored source docs, bounded for prompting.
 *  Returns null when the solution has none. */
export async function getCombinedSourceText(
  solutionId: string,
  cap = 16000
): Promise<{ name: string; text: string } | null> {
  const metas = await listSourceDocs(solutionId)
  if (!metas.length) return null
  const parts: string[] = []
  const names: string[] = []
  let total = 0
  for (const m of metas) {
    if (total >= cap) break
    try {
      const d = await getSourceDoc(solutionId, m.id)
      let t = d.text
      const remaining = cap - total
      if (t.length > remaining) t = t.slice(0, remaining)
      parts.push(`# ${d.name}\n${t}`)
      names.push(d.name)
      total += t.length
    } catch {
      // skip unreadable doc
    }
  }
  if (!parts.length) return null
  return { name: names.join(", "), text: parts.join("\n\n---\n\n") }
}
