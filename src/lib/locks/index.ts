// Lock provider factory.
//
// Locks are filesystem-only for now. Remote-Git providers (GitHub, ADO)
// could in principle write lock files to the data repo via the same
// GitProvider interface, but a per-heartbeat commit is expensive (rate
// limits, history noise) and the multi-user scenario the user asked
// for is specifically filesystem-shared. The factory returns a no-op
// provider with `supported = false` outside filesystem mode so callers
// can degrade gracefully.

import { FilesystemLockProvider } from "./filesystem-locks"
import { getGitProviderName } from "../git"
import type { LockProvider, LockStatus, LockAcquireResult } from "./types"

export type {
  EditLock,
  LockAcquireResult,
  LockAcquireSuccess,
  LockAcquireDenied,
  LockUnsupported,
  LockStatus,
  LockProvider,
} from "./types"
export { DEFAULT_LOCK_TTL_MS } from "./types"

class UnsupportedLockProvider implements LockProvider {
  readonly supported = false
  async acquire(): Promise<LockAcquireResult> {
    return {
      ok: false,
      reason: "unsupported",
      message:
        "Edit locks are only available when GIT_PROVIDER=filesystem. The current backend uses GitHub/ADO concurrency on save.",
    }
  }
  async refresh(): Promise<LockAcquireResult> {
    return this.acquire()
  }
  async release(): Promise<{ released: boolean }> {
    return { released: false }
  }
  async status(): Promise<LockStatus> {
    return { inUse: false }
  }
}

let _provider: LockProvider | null = null

export function getLockProvider(): LockProvider {
  if (_provider) return _provider
  if (getGitProviderName() === "filesystem") {
    const rootPath = process.env.FS_STORAGE_PATH
    if (!rootPath) {
      _provider = new UnsupportedLockProvider()
      return _provider
    }
    _provider = new FilesystemLockProvider({ rootPath })
    return _provider
  }
  _provider = new UnsupportedLockProvider()
  return _provider
}

// Tests / hot config swap.
export function resetLockProvider(): void {
  _provider = null
}
