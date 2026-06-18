// Deterministic solution skeleton proposer.
//
// Given an intent (name + the capabilities/processes the solution should
// deliver) and the component catalog, propose a starting skeleton:
//   - members  — existing components that already provide those
//                capabilities/processes, ranked by role strength, each
//                with a human-readable reason.
//   - gaps     — targets nothing covers → suggested new components.
//   - flows    — existing links between the chosen members (status
//                "existing"); the analyst adds the "proposed" delta.
//
// Pure function, no I/O. A future LLM proposer can emit the same
// `SolutionProposal` shape so the wizard/review/create path is unchanged.

import type {
  Component,
  ComponentType,
  SolutionMember,
  SolutionFlow,
  MemberDisposition,
} from "./types"

export interface ProposedMember extends SolutionMember {
  reason: string
}

export interface ProposedGap {
  kind: "capability" | "process"
  value: string
  suggestedName: string
  suggestedType: ComponentType
}

export interface ProposedFlow extends SolutionFlow {
  reason: string
}

export interface SolutionProposal {
  members: ProposedMember[]
  gaps: ProposedGap[]
  flows: ProposedFlow[]
}

export interface SolutionIntent {
  name: string
  capabilities: string[]
  processes: string[]
}

const norm = (s: string) => s.trim().toLowerCase()

// Role strength so a capability owner outranks a mere consumer when we
// pick the member's headline reason / ordering.
const CAP_ROLE_STRENGTH: Record<string, number> = {
  owner: 3,
  contributor: 2,
  consumer: 1,
  indirect: 1,
}
const PROC_ROLE_STRENGTH: Record<string, number> = {
  owner: 3,
  trigger: 3,
  participant: 2,
  listener: 1,
}

export function proposeSolution(
  intent: SolutionIntent,
  components: Component[]
): SolutionProposal {
  const wantedCaps = intent.capabilities.map(norm)
  const wantedProcs = intent.processes.map(norm)

  interface Acc {
    component: Component
    strength: number
    reasons: string[]
  }
  const picked = new Map<string, Acc>()
  const coveredCaps = new Set<string>()
  const coveredProcs = new Set<string>()

  const bump = (c: Component, strength: number, reason: string) => {
    const cur = picked.get(c.id)
    if (cur) {
      cur.strength = Math.max(cur.strength, strength)
      if (!cur.reasons.includes(reason)) cur.reasons.push(reason)
    } else {
      picked.set(c.id, { component: c, strength, reasons: [reason] })
    }
  }

  for (const c of components) {
    for (const cap of c.capabilities || []) {
      const key = norm(cap.name || "")
      if (!key || !wantedCaps.includes(key)) continue
      coveredCaps.add(key)
      const strength = CAP_ROLE_STRENGTH[cap.role] ?? 1
      bump(c, strength, `${cap.role} of capability “${cap.name}”`)
    }
    for (const p of c.processes || []) {
      const key = norm(p.name || "")
      if (!key || !wantedProcs.includes(key)) continue
      coveredProcs.add(key)
      const strength = PROC_ROLE_STRENGTH[p.role] ?? 1
      bump(c, strength, `${p.role} in process “${p.name}”`)
    }
  }

  const members: ProposedMember[] = Array.from(picked.values())
    .sort((a, b) => b.strength - a.strength || a.component.name.localeCompare(b.component.name))
    .map((acc) => ({
      component: acc.component.id,
      disposition: "reuse" as MemberDisposition,
      role: acc.reasons[0],
      reason: acc.reasons.join("; "),
    }))

  // Gaps: wanted targets that no component covered.
  const gaps: ProposedGap[] = []
  intent.capabilities.forEach((cap) => {
    if (!coveredCaps.has(norm(cap))) {
      gaps.push({
        kind: "capability",
        value: cap,
        suggestedName: `${cap} Service`,
        suggestedType: "service",
      })
    }
  })
  intent.processes.forEach((proc) => {
    if (!coveredProcs.has(norm(proc))) {
      gaps.push({
        kind: "process",
        value: proc,
        suggestedName: `${proc} Service`,
        suggestedType: "service",
      })
    }
  })

  // Existing links between chosen members → existing flows.
  const memberIds = new Set(members.map((m) => m.component))
  const byId = new Map(components.map((c) => [c.id, c]))
  const flows: ProposedFlow[] = []
  const seen = new Set<string>()
  for (const id of memberIds) {
    const c = byId.get(id)
    if (!c) continue
    for (const link of c.links || []) {
      if (!link.target || !memberIds.has(link.target) || link.target === id) continue
      const key = `${id}::${link.target}::${link.role}::${link.protocol ?? ""}`
      if (seen.has(key)) continue
      seen.add(key)
      flows.push({
        from: id,
        to: link.target,
        role: link.role,
        protocol: link.protocol,
        status: "existing",
        reason: "existing link in the catalog",
      })
    }
  }

  return { members, gaps, flows }
}
