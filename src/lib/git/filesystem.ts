// Filesystem GitProvider — stores the catalog directly under a
// configured root directory instead of pushing through a remote Git API.
//
// Designed for multi-user deployments where several analysts share a
// directory (local SSD, network share, NAS mount, etc.). The provider
// matches the existing GitProvider contract so the rest of arch-tool is
// agnostic to where the YAML lives:
//
//   • Reads walk the directory tree.
//   • Writes go through a temp-file + atomic rename pattern.
//   • Optimistic concurrency uses a SHA-256 of the current file content
//     as the opaque revision token returned from getFile(); putFile()
//     re-reads the file just before renaming and refuses to overwrite
//     when the hash drifted (someone else saved between read and write).
//   • A separate hard-lock subsystem (see src/lib/locks/) sits *in front
//     of* this provider so the UI can prevent two analysts entering the
//     edit form at the same time. The hash check here is the safety net
//     for the cases where a lock could not be honoured (TTL expired,
//     system writes, etc.).
//   • History is captured as JSONL sidecars under `_history/{path}.jsonl`
//     so the catalog still has a who/when/what trail when the operator
//     does not want a real Git remote.

import { promises as fsp, constants as fsc } from "node:fs"
import * as path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import type {
  GitProvider,
  GitFile,
  GitTreeEntry,
  GitCommitMeta,
  GitDescribe,
} from "./types"
import { GitNotFoundError } from "./types"
import type { ProbeTrace, ProbeStep } from "../diagnostics"
import { getRequestUser } from "../request-context"

// Encoded prefixes for the two opaque sha shapes we return. Keep callers
// blind to the encoding — they only ever pass the value back into
// getBlob() or putFile()/deleteFile().
const TREE_SHA_PREFIX = "fs:"
const HASH_SHA_PREFIX = "fs-hash:"

// Subdirectories the provider expects to find under the storage root.
// `_history` and `_locks` are arch-tool conventions; the others mirror
// the layout used by the GitHub/ADO backends.
export const REQUIRED_SUBDIRS = [
  "components",
  "diagrams",
  "confluence-links",
  "_history",
  "_locks",
] as const

export const HISTORY_DIR = "_history"

export class FilesystemProvider implements GitProvider {
  readonly name = "filesystem" as const
  // Filesystem storage has no notion of branches. The interface still
  // requires a string, so we expose a friendly constant for the UI.
  readonly branch = "(filesystem)"
  private rootPath: string

  constructor(opts: { rootPath: string }) {
    this.rootPath = path.resolve(opts.rootPath)
  }

  async listTree(prefix: string): Promise<GitTreeEntry[]> {
    const normalisedPrefix = prefix.replace(/\/+$/, "").replace(/^\/+/, "")
    const root = normalisedPrefix
      ? this.safeJoin(normalisedPrefix)
      : this.rootPath
    try {
      const stat = await fsp.stat(root)
      if (!stat.isDirectory()) return []
    } catch (err) {
      if (isNoSuchEntry(err)) return []
      throw err
    }
    const entries: GitTreeEntry[] = []
    await walk(root, this.rootPath, entries, normalisedPrefix)
    return entries
  }

  async getFile(filePath: string): Promise<GitFile> {
    const full = this.safeJoin(filePath)
    let buf: Buffer
    try {
      buf = await fsp.readFile(full)
    } catch (err) {
      if (isNoSuchEntry(err)) {
        throw new GitNotFoundError(`File not found: ${filePath}`)
      }
      throw err
    }
    const content = buf.toString("utf-8")
    return {
      path: filePath,
      content,
      sha: HASH_SHA_PREFIX + sha256Hex(buf),
    }
  }

  async getBlob(sha: string): Promise<string> {
    if (!sha.startsWith(TREE_SHA_PREFIX)) {
      // Defensive: callers should only feed us shas they got from
      // listTree(). A hash-shape sha cannot be resolved without a
      // hash → path index, which we do not maintain.
      throw new Error(
        `Filesystem getBlob expects a tree-shaped sha (got ${sha.slice(0, 16)}…)`
      )
    }
    const relPath = sha.slice(TREE_SHA_PREFIX.length)
    const full = this.safeJoin(relPath)
    try {
      return await fsp.readFile(full, "utf-8")
    } catch (err) {
      if (isNoSuchEntry(err)) {
        throw new GitNotFoundError(`Blob not found: ${relPath}`)
      }
      throw err
    }
  }

  async putFile(
    filePath: string,
    content: string,
    message: string,
    sha?: string
  ): Promise<void> {
    const full = this.safeJoin(filePath)
    await fsp.mkdir(path.dirname(full), { recursive: true })

    // Stage the new content to a sibling temp file so the partial
    // write is never visible under the real path.
    const tmpPath = `${full}.tmp.${randomUUID()}`
    await fsp.writeFile(tmpPath, content, "utf-8")

    try {
      // Concurrency check: read the current file (if any) and compare
      // its hash to the one the caller claims to have based their edit
      // on. Mismatch → reject. No sha → either a fresh create or a
      // caller that opted out of the check.
      if (sha !== undefined) {
        const expected = sha.startsWith(HASH_SHA_PREFIX)
          ? sha.slice(HASH_SHA_PREFIX.length)
          : sha
        const current = await readHashIfExists(full)
        if (current !== null && current !== expected) {
          const err = new Error(
            `Conflict: ${filePath} was modified by another user. Reload to see their changes, then re-apply yours.`
          ) as Error & { status?: number }
          err.status = 409
          throw err
        }
      }
      await atomicRename(tmpPath, full)
    } catch (e) {
      // Best-effort cleanup of the staged file. Swallow errors here
      // because the original failure is the one the caller needs to see.
      await fsp.unlink(tmpPath).catch(() => {})
      throw e
    }

    await appendHistory(this.rootPath, filePath, {
      ts: new Date().toISOString(),
      user: getRequestUser(),
      message,
      action: sha === undefined ? "create" : "edit",
    })
  }

  async deleteFile(
    filePath: string,
    sha: string,
    message: string
  ): Promise<void> {
    const full = this.safeJoin(filePath)
    const expected = sha.startsWith(HASH_SHA_PREFIX)
      ? sha.slice(HASH_SHA_PREFIX.length)
      : sha
    const current = await readHashIfExists(full)
    if (current === null) {
      throw new GitNotFoundError(`File not found: ${filePath}`)
    }
    if (current !== expected) {
      const err = new Error(
        `Conflict: ${filePath} was modified by another user — delete refused.`
      ) as Error & { status?: number }
      err.status = 409
      throw err
    }
    await fsp.unlink(full)
    await appendHistory(this.rootPath, filePath, {
      ts: new Date().toISOString(),
      user: getRequestUser(),
      message,
      action: "delete",
    })
  }

  async listFileHistory(
    filePath: string,
    limit: number
  ): Promise<GitCommitMeta[]> {
    const historyPath = path.join(this.rootPath, HISTORY_DIR, filePath + ".jsonl")
    let raw: string
    try {
      raw = await fsp.readFile(historyPath, "utf-8")
    } catch (err) {
      if (isNoSuchEntry(err)) return []
      throw err
    }
    const lines = raw.split(/\n+/).filter((l) => l.trim().length > 0)
    // Newest first; cap to limit.
    const tail = lines.slice(-limit).reverse()
    const out: GitCommitMeta[] = []
    for (const line of tail) {
      try {
        const entry = JSON.parse(line) as {
          ts?: string
          user?: string
          message?: string
          action?: string
        }
        out.push({
          // No commit hash on filesystem — surface a short timestamp-
          // derived id so the UI's "sha" column still has a value.
          sha: shortTsId(entry.ts || ""),
          message: entry.message || "(no message)",
          author: entry.user || "anonymous",
          date: entry.ts || "",
        })
      } catch {
        // Skip malformed lines; do not let one corrupt entry break the
        // whole timeline.
      }
    }
    return out
  }

  describe(): GitDescribe {
    return {
      provider: "filesystem",
      baseUrl: this.rootPath,
      branch: this.branch,
      repoIdentifier: this.rootPath,
      authScheme: "Filesystem permissions",
      authHint: "(process user)",
    }
  }

  async probe(): Promise<ProbeTrace> {
    const t0 = Date.now()
    const steps: ProbeStep[] = []

    // Step 1: resolve — confirm the path is valid and absolute.
    try {
      const resolved = path.resolve(this.rootPath)
      steps.push({
        step: "dns",
        label: "resolve",
        ok: true,
        ms: 0,
        detail: `Storage root: ${resolved}`,
      })
    } catch (err) {
      steps.push({
        step: "dns",
        label: "resolve",
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      })
      steps.push({
        step: "classify",
        ok: false,
        category: "unknown",
        hint: "Could not resolve the storage path. Check FS_STORAGE_PATH is set to an absolute path.",
      })
      return { ok: false, totalMs: Date.now() - t0, steps }
    }

    // Step 2: access — exists, is a directory, readable + writable.
    const accessStart = Date.now()
    try {
      const stat = await fsp.stat(this.rootPath)
      if (!stat.isDirectory()) {
        steps.push({
          step: "request",
          label: "access",
          ok: false,
          ms: Date.now() - accessStart,
          detail: `Path exists but is not a directory.`,
        })
        steps.push({
          step: "classify",
          ok: false,
          category: "unknown",
          hint: "FS_STORAGE_PATH must point at a directory.",
        })
        return { ok: false, totalMs: Date.now() - t0, steps }
      }
      await fsp.access(this.rootPath, fsc.R_OK | fsc.W_OK)
      steps.push({
        step: "request",
        label: "access",
        ok: true,
        ms: Date.now() - accessStart,
        detail: "Directory exists, read + write OK.",
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      steps.push({
        step: "request",
        label: "access",
        ok: false,
        ms: Date.now() - accessStart,
        detail,
      })
      const missing = isNoSuchEntry(err)
      steps.push({
        step: "classify",
        ok: false,
        category: "unknown",
        hint: missing
          ? `Storage root does not exist. Create the directory or update FS_STORAGE_PATH.`
          : `Storage root is not accessible. Check that the process user has read + write permission on the directory.`,
      })
      return { ok: false, totalMs: Date.now() - t0, steps }
    }

    // Step 3: initialization check — are the expected sub-directories
    // there? The Settings UI uses `missingSubdirs` to decide whether to
    // show the "Initialize storage" button.
    const initStart = Date.now()
    const missingSubdirs: string[] = []
    for (const sub of REQUIRED_SUBDIRS) {
      try {
        const s = await fsp.stat(path.join(this.rootPath, sub))
        if (!s.isDirectory()) missingSubdirs.push(sub)
      } catch (err) {
        if (isNoSuchEntry(err)) missingSubdirs.push(sub)
        else throw err
      }
    }
    if (missingSubdirs.length > 0) {
      steps.push({
        step: "response",
        label: "contents",
        ok: false,
        ms: Date.now() - initStart,
        detail: `Missing sub-directories: ${missingSubdirs.join(", ")}`,
        bodyExcerpt: JSON.stringify({ missingSubdirs }, null, 2),
      })
      steps.push({
        step: "classify",
        ok: false,
        category: "unknown",
        hint: `Storage is not initialised. Use the "Initialize storage" button in Settings to create the required sub-directories, or run mkdir for: ${missingSubdirs.join(", ")}.`,
      })
      return { ok: false, totalMs: Date.now() - t0, steps }
    }

    // Sample counts so the operator can see arch-tool is talking to
    // the directory they think it is talking to.
    const componentCount = await countFiles(
      path.join(this.rootPath, "components"),
      ".yaml"
    )
    const diagramCount = await countFiles(
      path.join(this.rootPath, "diagrams"),
      ".drawio"
    )
    steps.push({
      step: "response",
      label: "contents",
      ok: true,
      ms: Date.now() - initStart,
      detail: `Initialised — ${componentCount} components, ${diagramCount} diagrams.`,
    })

    // Step 4: write-test — make sure we actually can write, not just
    // that the directory looks writable from the metadata.
    const writeStart = Date.now()
    const probeFile = path.join(this.rootPath, `.arch-tool-probe-${randomUUID()}`)
    try {
      await fsp.writeFile(probeFile, "ok", "utf-8")
      await fsp.unlink(probeFile)
      steps.push({
        step: "response",
        label: "write-test",
        ok: true,
        ms: Date.now() - writeStart,
        detail: "Temp file created and deleted.",
      })
    } catch (err) {
      steps.push({
        step: "response",
        label: "write-test",
        ok: false,
        ms: Date.now() - writeStart,
        detail: err instanceof Error ? err.message : String(err),
      })
      steps.push({
        step: "classify",
        ok: false,
        category: "unknown",
        hint: "Write test failed even though access metadata looked OK. Check disk space, SELinux/AppArmor, or filesystem quota.",
      })
      return { ok: false, totalMs: Date.now() - t0, steps }
    }

    return { ok: true, totalMs: Date.now() - t0, steps }
  }

  // Resolve a relative path under the storage root, refusing any value
  // that would escape via `..`, absolute paths, or null bytes. Symbolic
  // links are followed transparently — the operator owns the layout
  // under FS_STORAGE_PATH and can choose to mount sub-trees via links.
  private safeJoin(relPath: string): string {
    if (relPath.includes("\0")) {
      throw new Error(`Invalid path: null byte`)
    }
    if (path.isAbsolute(relPath)) {
      throw new Error(`Path must be relative: ${relPath}`)
    }
    const candidate = path.resolve(this.rootPath, relPath)
    const root = this.rootPath
    if (candidate !== root && !candidate.startsWith(root + path.sep)) {
      throw new Error(`Path escapes storage root: ${relPath}`)
    }
    return candidate
  }
}

// Walk a directory recursively and emit GitTreeEntry rows for every
// file. The walker respects the `_history`/`_locks` arch-tool
// conventions: their contents are not exposed via listTree() because
// they are internal mechanics, not part of the catalog itself.
async function walk(
  current: string,
  root: string,
  out: GitTreeEntry[],
  prefix: string
): Promise<void> {
  let entries
  try {
    entries = await fsp.readdir(current, { withFileTypes: true })
  } catch (err) {
    if (isNoSuchEntry(err)) return
    throw err
  }
  for (const e of entries) {
    const full = path.join(current, e.name)
    const relFromRoot = path.relative(root, full).replace(/\\/g, "/")
    if (e.isDirectory()) {
      if (relFromRoot === HISTORY_DIR || relFromRoot === "_locks") continue
      if (relFromRoot.startsWith("_history/") || relFromRoot.startsWith("_locks/")) continue
      await walk(full, root, out, prefix)
      continue
    }
    if (!e.isFile()) continue
    // The prefix filter operates on the path relative to root.
    if (prefix && !relFromRoot.startsWith(prefix.endsWith("/") ? prefix : prefix + "/")) {
      // The prefix may already be a directory itself (e.g. "components")
      // in which case `walk` was called against that directory directly
      // and every file inside is in-scope — keep it.
    }
    out.push({
      path: relFromRoot,
      sha: TREE_SHA_PREFIX + relFromRoot,
      type: "blob",
    })
  }
}

async function readHashIfExists(full: string): Promise<string | null> {
  try {
    const buf = await fsp.readFile(full)
    return sha256Hex(buf)
  } catch (err) {
    if (isNoSuchEntry(err)) return null
    throw err
  }
}

async function atomicRename(from: string, to: string): Promise<void> {
  // fs.rename replaces the destination on POSIX and on Windows since
  // Node 14+. On a network share that does not support overwriting via
  // rename, this will throw EEXIST — operators should pick storage on
  // a filesystem with proper rename semantics.
  await fsp.rename(from, to)
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

function isNoSuchEntry(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: string }).code === "ENOENT"
  )
}

async function countFiles(dir: string, extension: string): Promise<number> {
  let count = 0
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(extension)) count++
    }
  } catch {
    // Best-effort — empty dirs or missing dirs are reported as 0.
  }
  return count
}

interface HistoryEntry {
  ts: string
  user: string
  message: string
  action: "create" | "edit" | "delete"
}

async function appendHistory(
  rootPath: string,
  filePath: string,
  entry: HistoryEntry
): Promise<void> {
  const historyFile = path.join(rootPath, HISTORY_DIR, filePath + ".jsonl")
  try {
    await fsp.mkdir(path.dirname(historyFile), { recursive: true })
    await fsp.appendFile(historyFile, JSON.stringify(entry) + "\n", "utf-8")
  } catch {
    // History is best-effort. A history-sidecar failure must not break
    // the user's save — the data file is already on disk via atomic
    // rename at this point. Operators who want guaranteed audit logs
    // should use GitHub / ADO storage.
  }
}

function shortTsId(ts: string): string {
  // Derive a short, stable, monotone-ish id from the timestamp so the
  // History tab still has a "sha" column to render. Not cryptographic.
  if (!ts) return "fs00000"
  const cleaned = ts.replace(/[^0-9]/g, "")
  return ("fs" + cleaned).slice(0, 9)
}
