// Shared builder for the enriched member context sent to the
// process-draft endpoint. Both the composer and the solution editor use
// this so the AI sees the SAME grounding: each member's type, its
// disposition + role in the solution, and a couple of its capabilities.
// That richer context is what lets the drafter route a step to the member
// that actually carries it (e.g. a "store" step → a storage component)
// instead of dumping every step as a note on one lifeline.
//
// Catalog-derived only (names/types/capabilities the analyst maintains) —
// no example values are hard-coded here, so nothing vendor-specific lives
// in the repo.

export interface ProcessDraftMember {
  id: string
  name: string
  type?: string
  disposition?: string
  role?: string
  capabilities?: string[]
}

interface MemberInput {
  component: string
  disposition?: string
  role?: string
}

interface ResolvedComponent {
  name?: string
  type?: string
  capabilities?: { name?: string }[]
}

export function buildProcessDraftMembers(
  members: MemberInput[],
  resolve: (id: string) => ResolvedComponent | undefined
): ProcessDraftMember[] {
  return members.map((m) => {
    const c = resolve(m.component)
    const capabilities = (c?.capabilities || [])
      .map((cap) => (cap?.name || "").trim())
      .filter(Boolean)
      .slice(0, 2)
    return {
      id: m.component,
      name: c?.name || m.component,
      type: c?.type ? String(c.type) : undefined,
      disposition: m.disposition,
      role: m.role,
      capabilities: capabilities.length ? capabilities : undefined,
    }
  })
}
