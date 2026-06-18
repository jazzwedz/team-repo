// Filesystem-backed edit lock store.
//
// One lock = one JSON file under {STORAGE_ROOT}/_locks/{componentId}.lock.
// Acquire uses an exclusive create (open with `wx`) so two callers
// racing for the same component cannot both succeed. Expired locks are
// treated as free; corrupted lock files are also treated as free so a
// stray write cannot block the team indefinitely.
//
// The lock is advisory — its purpose is multi-user UX, not data safety.
// The filesystem provider's hash-based optimistic concurrency on
// putFile() is the actual safety net (and applies to any provider).

import { promises as fsp } from "node:fs"
import * as path from "node:path"
import { randomUUID } from "node:crypto"
import {
  DEFAULT_LOCK_TTL_MS,
  type EditLock,
  type LockAcquireResult,
  type LockProvider,
  type LockStatus,
} from "./types"

const LOCKS_DIR = "_locks"

export class FilesystemLockProvider implements LockProvider {
  readonly supported = true
  private rootPath: string

  constructor(opts: { rootPath: string }) {
    this.rootPath = path.resolve(opts.rootPath)
  }

  async acquire(componentId: string, user: string): Promise<LockAcquireResult> {
    return this.acquireInternal(componentId, user, false)
  }

  async refresh(componentId: string, user: string): Promise<LockAcquireResult> {
    // refresh and acquire are the same shape — refresh just makes the
    // intent explicit: we expect to already own the lock and want to
    // bump the TTL. acquireInternal accepts both paths.
    return this.acquireInternal(componentId, user, true)
  }

  async release(
    componentId: string,
    user: string
  ): Promise<{ released: boolean }> {
    const lockPath = this.lockPath(componentId)
    const existing = await this.readLockOrNull(lockPath)
    if (!existing) return { released: false }
    if (existing.user !== user) return { released: false }
    try {
      await fsp.unlink(lockPath)
      return { released: true }
    } catch {
      return { released: false }
    }
  }

  async status(componentId: string, user: string): Promise<LockStatus> {
    const lockPath = this.lockPath(componentId)
    const existing = await this.readLockOrNull(lockPath)
    if (!existing) return { inUse: false }
    if (isExpired(existing)) return { inUse: false }
    return {
      inUse: true,
      current: existing,
      ownedByYou: existing.user === user,
    }
  }

  private async acquireInternal(
    componentId: string,
    user: string,
    isRefresh: boolean
  ): Promise<LockAcquireResult> {
    await this.ensureLocksDir()
    const lockPath = this.lockPath(componentId)

    // Read any existing lock first so we can short-circuit when it is
    // active and not ours.
    const existing = await this.readLockOrNull(lockPath)
    if (existing && !isExpired(existing) && existing.user !== user) {
      return { ok: false, reason: "held-by-other", current: existing }
    }

    const newLock: EditLock = {
      componentId,
      user,
      acquiredAt:
        existing && existing.user === user && !isExpired(existing)
          ? existing.acquiredAt
          : new Date().toISOString(),
      expiresAt: new Date(Date.now() + DEFAULT_LOCK_TTL_MS).toISOString(),
    }

    const payload = JSON.stringify(newLock, null, 2) + "\n"

    // If we are taking over an expired lock or refreshing our own, the
    // file already exists — overwrite atomically via temp + rename.
    if (existing) {
      await this.atomicReplace(lockPath, payload)
      return { ok: true, lock: newLock }
    }

    // No existing lock — use exclusive create to avoid a race with
    // another acquirer.
    try {
      const fh = await fsp.open(lockPath, "wx")
      try {
        await fh.writeFile(payload, "utf-8")
      } finally {
        await fh.close()
      }
      return { ok: true, lock: newLock }
    } catch (err) {
      if (isEEXIST(err)) {
        // Lost the race with another acquirer. Re-read and decide.
        const after = await this.readLockOrNull(lockPath)
        if (!after) {
          // The file appeared and vanished — try one more time via
          // overwrite. Conservative: report as held to avoid loops.
          if (!isRefresh) {
            return {
              ok: false,
              reason: "held-by-other",
              current: {
                componentId,
                user: "unknown",
                acquiredAt: new Date().toISOString(),
                expiresAt: new Date(
                  Date.now() + DEFAULT_LOCK_TTL_MS
                ).toISOString(),
              },
            }
          }
          await this.atomicReplace(lockPath, payload)
          return { ok: true, lock: newLock }
        }
        if (after.user === user || isExpired(after)) {
          await this.atomicReplace(lockPath, payload)
          return { ok: true, lock: newLock }
        }
        return { ok: false, reason: "held-by-other", current: after }
      }
      throw err
    }
  }

  private lockPath(componentId: string): string {
    // Lock filenames mirror the componentId. Validation upstream
    // (isValidName) keeps the id safe to use as a filename.
    return path.join(this.rootPath, LOCKS_DIR, `${componentId}.lock`)
  }

  private async ensureLocksDir(): Promise<void> {
    await fsp.mkdir(path.join(this.rootPath, LOCKS_DIR), { recursive: true })
  }

  private async readLockOrNull(lockPath: string): Promise<EditLock | null> {
    try {
      const raw = await fsp.readFile(lockPath, "utf-8")
      const parsed = JSON.parse(raw) as EditLock
      if (
        typeof parsed.componentId === "string" &&
        typeof parsed.user === "string" &&
        typeof parsed.acquiredAt === "string" &&
        typeof parsed.expiresAt === "string"
      ) {
        return parsed
      }
      // Corrupt shape — treat as missing so we can recover.
      return null
    } catch (err) {
      if (isEnoent(err)) return null
      // Anything else (parse error, IO error) — treat as missing so the
      // team is not blocked by a stray write.
      return null
    }
  }

  private async atomicReplace(targetPath: string, content: string): Promise<void> {
    const tmp = `${targetPath}.tmp.${randomUUID()}`
    await fsp.writeFile(tmp, content, "utf-8")
    try {
      await fsp.rename(tmp, targetPath)
    } catch (e) {
      await fsp.unlink(tmp).catch(() => {})
      throw e
    }
  }
}

function isExpired(lock: EditLock): boolean {
  const expiresAt = Date.parse(lock.expiresAt)
  if (Number.isNaN(expiresAt)) return true // unparseable → treat as free
  return Date.now() >= expiresAt
}

function isEEXIST(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: string }).code === "EEXIST"
  )
}

function isEnoent(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: string }).code === "ENOENT"
  )
}
