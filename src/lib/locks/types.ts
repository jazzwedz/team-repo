// Hard edit lock — one user at a time owns the right to edit a given
// component. Other users see a banner with the owner's name and switch
// to read-only mode. The lock has a TTL so a crashed browser or a
// laptop closed without releasing the lock cannot block the team for
// long. A heartbeat from the active editor extends the TTL while the
// edit page is open.

export interface EditLock {
  componentId: string
  user: string
  acquiredAt: string // ISO 8601
  expiresAt: string // ISO 8601
}

export interface LockAcquireSuccess {
  ok: true
  lock: EditLock
}

export interface LockAcquireDenied {
  ok: false
  reason: "held-by-other"
  current: EditLock
}

export interface LockUnsupported {
  ok: false
  reason: "unsupported"
  message: string
}

export type LockAcquireResult = LockAcquireSuccess | LockAcquireDenied | LockUnsupported

export interface LockStatus {
  inUse: boolean
  current?: EditLock
  // Whether the active user is the lock owner.
  ownedByYou?: boolean
}

// TTL in ms. Bumped on every heartbeat.
export const DEFAULT_LOCK_TTL_MS = 10 * 60 * 1000

export interface LockProvider {
  readonly supported: boolean
  acquire(componentId: string, user: string): Promise<LockAcquireResult>
  refresh(componentId: string, user: string): Promise<LockAcquireResult>
  release(componentId: string, user: string): Promise<{ released: boolean }>
  status(componentId: string, user: string): Promise<LockStatus>
}
