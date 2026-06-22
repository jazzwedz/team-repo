// Source documents used to extract a component's business rules.
//
// Stored as sidecar files in the data repo under
// rule-docs/<componentId>/<docId>.md — the extracted plain text with a
// small YAML front-matter. Kept OUT of the component YAML so the catalog
// stays light; the (potentially large) text is fetched only when needed
// (re-extraction, re-download). This is the per-component analogue of
// source-docs-store (which does the same for solutions). A document is
// stored the first time it is used for a rules import, so the analyst can
// see what a component's rules were derived from and re-extract later.

import yaml from "js-yaml"
import { getGit, GitNotFoundError } from "./git"
import { getLogger } from "./log"

export interface RuleDocMeta {
  id: string
  name: string
  createdAt: string
  chars: number
}

export interface RuleDoc extends RuleDocMeta {
  text: string
  sha?: string
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/

function dirFor(componentId: string): string {
  return `rule-docs/${componentId}/`
}
function pathFor(componentId: string, docId: string): string {
  return `rule-docs/${componentId}/${docId}.md`
}

export function newRuleDocId(): string {
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

/** List stored rule-doc metadata for a component (newest first), no bodies. */
export async function listRuleDocs(componentId: string): Promise<RuleDocMeta[]> {
  const git = getGit()
  let entries: { path: string; sha: string }[]
  try {
    entries = await git.listTree(dirFor(componentId))
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
        } as RuleDocMeta
      } catch (err) {
        getLogger().error(`Failed to read rule doc ${f.path}`, {
          err: err instanceof Error ? err.message : String(err),
        })
        return null
      }
    })
  )
  return (metas.filter(Boolean) as RuleDocMeta[]).sort((a, b) =>
    (b.createdAt || "").localeCompare(a.createdAt || "")
  )
}

export async function getRuleDoc(componentId: string, docId: string): Promise<RuleDoc> {
  if (!SAFE_ID.test(docId)) throw new GitNotFoundError("Invalid rule doc id")
  const git = getGit()
  const file = await git.getFile(pathFor(componentId, docId))
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

export async function saveRuleDoc(
  componentId: string,
  input: { name: string; text: string }
): Promise<RuleDocMeta> {
  const git = getGit()
  const id = newRuleDocId()
  const meta: StoredMeta = {
    id,
    name: input.name?.trim() || "rule source document",
    createdAt: new Date().toISOString(),
  }
  await git.putFile(
    pathFor(componentId, id),
    serialize(meta, input.text),
    `docs: add rule source document ${id} for ${componentId}`
  )
  return { ...meta, chars: input.text.length }
}

export async function deleteRuleDoc(componentId: string, docId: string): Promise<void> {
  if (!SAFE_ID.test(docId)) throw new GitNotFoundError("Invalid rule doc id")
  const git = getGit()
  const file = await git.getFile(pathFor(componentId, docId))
  await git.deleteFile(
    pathFor(componentId, docId),
    file.sha,
    `docs: remove rule source document ${docId} for ${componentId}`
  )
}
