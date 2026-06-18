// Deterministic consistency checker for the catalog.
//
// Scans every component and yields a list of well-typed Issue objects
// — each describing exactly one missing backlink and exactly one
// atomic patch that would resolve it. Pure functions throughout: no
// I/O, no caching, no side effects. The API route loads components,
// runs `findInconsistencies`, hands the list back to the UI, and
// the apply endpoint reuses `applyFix` to mutate the target.
//
// Rules (v2 — links[]):
//
//   For every link whose target is a known component, the target
//   should declare the inverse role back (LINK_ROLE_INVERSE). All
//   three role pairs are audited:
//     - calls       ↔ serves      (API edge declared from both sides)
//     - part-of     ↔ contains    (containment declared from both sides)
//     - reads-from  ↔ writes-to   (data flow declared from both sides)
//   A mirror matches when target + role + `protocol` + `name` all
//   agree, so two APIs with different protocols, or two data items
//   with different `name`s, on the same target stay as separate edges
//   (each needing its own mirror). Links targeting an unknown id (a
//   free-form external label) are skipped.
//
// Each issue carries a stable id encoding the source declaration so
// the apply endpoint can re-find it from a fresh scan and refuse the
// click idempotently when the user double-fires or has already
// resolved it through another path.

import type { Component, ComponentLink } from "./types"
import { LINK_ROLE_INVERSE, LINK_ROLE_LABELS } from "./constants"

export type ConsistencyFix =
  | { kind: "addLink"; link: ComponentLink }
  /**
   * Remove duplicate links sharing the same identity
   * (target + role + protocol + name) from a component, keeping the
   * first occurrence. `link` carries that identity.
   */
  | { kind: "dedupeLink"; link: ComponentLink }

export type IssueCategory = "duplicate-links" | "links" | "inferred-links"

export interface ConsistencyIssue {
  /**
   * Stable id used as React key and as the lookup key in the apply
   * route. Encodes category + source declaration + target so a fresh
   * scan can resurface the same issue deterministically.
   */
  id: string
  category: IssueCategory
  /** Component the patch lands on. */
  applyTo: string
  applyToName: string
  /** Component that holds the original declaration (context only). */
  declaredOn: string
  declaredOnName: string
  /** Short headline shown as the row title. */
  title: string
  /** One-sentence explanation. */
  details: string
  /** Opaque patch payload for the apply endpoint. */
  fix: ConsistencyFix
  /**
   * Where the issue came from. Deterministic checks (duplicate-links,
   * links) omit this — they are exact and re-derivable from a fresh
   * scan. AI-inferred issues set "ai": they are advisory, carry a
   * confidence + rationale, and cannot be re-found by `findInconsistencies`,
   * so the apply endpoint takes their fix inline instead of by id.
   */
  source?: "deterministic" | "ai"
  /** 0–1, only on AI-inferred issues. */
  confidence?: number
  /** Why the AI proposed this link (cites the evidence). AI issues only. */
  rationale?: string
}

// ----------------------------- detection -----------------------------

export function findInconsistencies(components: Component[]): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []
  const byId = new Map<string, Component>(components.map((c) => [c.id, c]))

  for (const source of components) {
    // Duplicate links first so the data is deduped before mirror checks
    // act on it (a deduped component produces one mirror issue, not N).
    checkDuplicateLinks(source, issues)
    checkLinks(source, byId, issues)
  }

  // Dedupe issues by stable id. Duplicate links on a component would
  // otherwise emit the same mirror issue more than once (the mirror id
  // does not include the link `name`), making the list appear to
  // "multiply" — keep the first of each id.
  const byIssueId = new Map<string, ConsistencyIssue>()
  for (const it of issues) if (!byIssueId.has(it.id)) byIssueId.set(it.id, it)
  const deduped = Array.from(byIssueId.values())

  // Sort: by category, then by applyTo name so rows in the same
  // target component cluster visually in the UI.
  const categoryOrder: Record<IssueCategory, number> = {
    "duplicate-links": 0,
    links: 1,
    // findInconsistencies never emits inferred-links (those come from the
    // AI auditor in relationship-audit.ts) — listed only to keep the map
    // total over IssueCategory.
    "inferred-links": 2,
  }
  return deduped.sort((a, b) => {
    const c = categoryOrder[a.category] - categoryOrder[b.category]
    if (c !== 0) return c
    const t = a.applyToName.localeCompare(b.applyToName)
    if (t !== 0) return t
    return a.title.localeCompare(b.title)
  })
}

// --- v2 links: duplicate detection ---
//
// A component should carry each edge once. Re-imports, manual edits, or
// a legacy migration that ran twice can leave several identical links
// (same target + role + protocol + name). Each such group becomes one
// issue whose fix keeps the first occurrence and drops the rest.

// Containment is unique per target — a component is "part of" (or
// "contains") another at most once, so two such links to the same target
// are duplicates even if their name/description differ. Every other role
// can legitimately repeat to the same target with a different name (e.g.
// two `reads-from` for two different datasets), so those keep name +
// protocol in the identity.
function isContainmentRole(role: string): boolean {
  return role === "part-of" || role === "contains"
}

function linkIdentity(link: ComponentLink): string {
  return isContainmentRole(link.role)
    ? `${link.target}::${link.role}`
    : `${link.target}::${link.role}::${link.protocol ?? ""}::${link.name ?? ""}`
}

function checkDuplicateLinks(source: Component, out: ConsistencyIssue[]): void {
  const counts = new Map<string, { link: ComponentLink; count: number }>()
  for (const link of source.links || []) {
    if (!link.target) continue
    const key = linkIdentity(link)
    const entry = counts.get(key)
    if (entry) entry.count += 1
    else counts.set(key, { link, count: 1 })
  }

  for (const { link, count } of counts.values()) {
    if (count < 2) continue
    const extra = count - 1
    const proto = link.protocol ? ` over ${link.protocol}` : ""
    const named = link.name ? ` (${link.name})` : ""
    out.push({
      id: `dup:${source.id}:${link.role}:${link.protocol ?? ""}:${link.name ?? ""}:${link.target}`,
      category: "duplicate-links",
      applyTo: source.id,
      applyToName: source.name,
      declaredOn: source.id,
      declaredOnName: source.name,
      title: `${source.name} has ${count} copies of "${LINK_ROLE_LABELS[link.role]}: ${link.target}"`,
      details: `The link "${LINK_ROLE_LABELS[link.role]}: ${link.target}"${proto}${named} appears ${count} times. Keep one and remove the ${extra} duplicate${extra === 1 ? "" : "s"}.`,
      fix: {
        kind: "dedupeLink",
        link: {
          target: link.target,
          role: link.role,
          ...(link.protocol ? { protocol: link.protocol } : {}),
          ...(link.name ? { name: link.name } : {}),
        },
      },
    })
  }
}

// --- v2 links: mirror pair check ---
//
// Every role has an inverse (LINK_ROLE_INVERSE), so all three pairs are
// audited: calls ↔ serves, part-of ↔ contains, and reads-from ↔
// writes-to. For data-flow edges the `name` field is part of the match
// key, so the suggested mirror carries the same data-item identity.

function checkLinks(
  source: Component,
  byId: Map<string, Component>,
  out: ConsistencyIssue[]
): void {
  for (const link of source.links || []) {
    if (!link.target) continue
    const target = byId.get(link.target)
    if (!target) continue

    const inverseRole = LINK_ROLE_INVERSE[link.role]
    if (!inverseRole) continue

    // Match key allows multiple distinct edges on the same target with
    // different protocols or data names. For interface edges (calls /
    // serves) the protocol disambiguates two distinct APIs; for data
    // edges (reads-from / writes-to) the `name` field carries the
    // DataItem identity so two writes-to with different names stay as
    // two real edges.
    const hasMirror = (target.links || []).some(
      (l) =>
        l.target === source.id &&
        l.role === inverseRole &&
        (l.protocol ?? "") === (link.protocol ?? "") &&
        (l.name ?? "") === (link.name ?? "")
    )
    if (hasMirror) continue

    out.push({
      id: `link:${source.id}:${link.role}:${link.protocol ?? ""}:${target.id}`,
      category: "links",
      applyTo: target.id,
      applyToName: target.name,
      declaredOn: source.id,
      declaredOnName: source.name,
      title: `${target.name} is missing "${inverseRole}: ${source.id}"`,
      details: `${source.name} declares "${LINK_ROLE_LABELS[link.role]}: ${target.id}"${link.protocol ? ` over ${link.protocol}` : ""}, so ${target.name} should declare "${LINK_ROLE_LABELS[inverseRole]}: ${source.id}" in return.`,
      fix: {
        kind: "addLink",
        link: {
          target: source.id,
          role: inverseRole,
          ...(link.protocol ? { protocol: link.protocol } : {}),
          ...(link.name ? { name: link.name } : {}),
          ...(link.description ? { description: link.description } : {}),
        },
      },
    })
  }
}

// v2 Phase 2: data input/output checks are gone. Data flow lives in
// links[] now with role reads-from / writes-to, and the mirror pair
// in checkLinks handles the same audit (target + role + name match).

// ----------------------------- apply -----------------------------

/**
 * Apply a single fix to a component, returning a new Component object.
 * Pure function — no I/O. The caller is responsible for persisting the
 * result. Defensive: if the patch target row no longer exists (e.g.
 * the user already removed the output during their last edit), the
 * fix degrades to a sensible default (typically a no-op) instead of
 * throwing.
 */
export function applyFix(component: Component, fix: ConsistencyFix): Component {
  // Cheap deep clone via structured serialisation; the catalog YAML is
  // small enough that this is faster than hand-rolling deep copies and
  // immune to future schema additions.
  const next = JSON.parse(JSON.stringify(component)) as Component

  switch (fix.kind) {
    case "addLink": {
      // Idempotent: if an identical link already exists (same target +
      // role + protocol + name) adding it again is a no-op. Guards both
      // the deterministic mirror path and the inline AI-apply path, where
      // there is no fresh re-scan to refuse a double click.
      const exists = (next.links || []).some(
        (l) =>
          l.target === fix.link.target &&
          l.role === fix.link.role &&
          (l.protocol ?? "") === (fix.link.protocol ?? "") &&
          (l.name ?? "") === (fix.link.name ?? "")
      )
      if (exists) return next
      next.links = [...(next.links || []), fix.link]
      return next
    }
    case "dedupeLink": {
      // Keep the first link matching the identity, drop the rest. Other
      // links are untouched. Identity matches the detection rule: for
      // containment roles it is target + role (name/protocol ignored);
      // for every other role it is target + role + protocol + name.
      const target = fix.link.target
      const role = fix.link.role
      const proto = fix.link.protocol ?? ""
      const nm = fix.link.name ?? ""
      const containment = isContainmentRole(role)
      let kept = false
      next.links = (next.links || []).filter((l) => {
        const match = containment
          ? l.target === target && l.role === role
          : l.target === target &&
            l.role === role &&
            (l.protocol ?? "") === proto &&
            (l.name ?? "") === nm
        if (!match) return true
        if (!kept) {
          kept = true
          return true
        }
        return false
      })
      return next
    }
  }
}
