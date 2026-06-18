// POST /api/admin/consistency-check/apply
//
// Two shapes, one endpoint:
//
//   { issueId: string }                       — deterministic issue
//   { applyTo: string, fix: ConsistencyFix }  — AI-inferred issue
//
// Deterministic issues are re-derivable: the route re-runs the scan
// against the live catalog and looks up the issue by its stable id,
// which makes the call idempotent — if it was already resolved the
// lookup misses and the API returns 404 instead of double-applying.
//
// AI-inferred issues cannot be re-found by findInconsistencies, so the
// caller passes the fix inline. Idempotency here comes from applyFix
// itself (addLink is a no-op when the identical link already exists):
// re-applying produces an unchanged component, which the route detects
// and reports as success without an empty commit. Only `addLink` is
// accepted inline, and its link role/protocol are validated against the
// enums so the endpoint can't be used to write arbitrary data.

import { NextResponse } from "next/server"
import { getComponent, listComponents, saveComponent } from "@/lib/github"
import { applyFix, findInconsistencies, type ConsistencyFix } from "@/lib/consistency"
import { isValidName } from "@/lib/validate"
import { LINK_ROLES, LINK_PROTOCOLS } from "@/lib/constants"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

interface Body {
  issueId?: string
  applyTo?: string
  fix?: ConsistencyFix
}

/** Validate an inline AI fix — only addLink with valid enums is accepted. */
function validInlineFix(fix: unknown): fix is ConsistencyFix {
  if (!fix || typeof fix !== "object") return false
  const f = fix as Record<string, unknown>
  if (f.kind !== "addLink") return false
  const link = f.link as Record<string, unknown> | undefined
  if (!link || typeof link.target !== "string" || !link.target) return false
  if (!LINK_ROLES.includes(link.role as never)) return false
  if (link.protocol !== undefined && !LINK_PROTOCOLS.includes(link.protocol as never)) return false
  return true
}

export async function POST(request: Request) {
  return withRouteContext(request, async () => {
    let body: Body
    try {
      body = (await request.json()) as Body
    } catch {
      return NextResponse.json({ error: "Body must be JSON." }, { status: 400 })
    }
    // Resolve { applyTo, fix } from either an inline AI fix or a
    // deterministic issue looked up by id.
    let applyTo: string
    let fix: ConsistencyFix
    let context: Record<string, unknown>

    if (body.fix !== undefined || body.applyTo !== undefined) {
      // Inline AI path.
      if (typeof body.applyTo !== "string" || !isValidName(body.applyTo)) {
        return NextResponse.json({ error: "Invalid or missing `applyTo`." }, { status: 400 })
      }
      if (!validInlineFix(body.fix)) {
        return NextResponse.json(
          { error: "Invalid `fix` — only an addLink with a valid role/protocol is accepted." },
          { status: 400 }
        )
      }
      applyTo = body.applyTo
      fix = body.fix as ConsistencyFix
      context = { applyTo, source: "ai", fixKind: fix.kind }
    } else {
      // Deterministic path — re-scan and look up by stable id.
      const issueId = body.issueId
      if (typeof issueId !== "string" || issueId === "") {
        return NextResponse.json({ error: "Missing field `issueId`." }, { status: 400 })
      }
      try {
        const components = await listComponents()
        const issue = findInconsistencies(components).find((i) => i.id === issueId)
        if (!issue) {
          return NextResponse.json(
            {
              error:
                "Issue not found. It may already be resolved or the catalog has changed — refresh the check.",
            },
            { status: 404 }
          )
        }
        applyTo = issue.applyTo
        fix = issue.fix
        context = { issueId, applyTo: issue.applyTo, category: issue.category, fixKind: issue.fix.kind }
      } catch (error) {
        getLogger().error("Failed to resolve consistency issue", {
          issueId,
          err: error instanceof Error ? error.message : "Unknown error",
        })
        return NextResponse.json(
          { error: `Failed to apply fix: ${error instanceof Error ? error.message : "Unknown error"}` },
          { status: 500 }
        )
      }
    }

    try {
      // Load the target with its current sha so saveComponent can do
      // optimistic concurrency through the git provider.
      const target = await getComponent(applyTo)
      const { sha, ...current } = target
      const updated = applyFix(current, fix)

      // Idempotent no-op (e.g. AI link already present): skip the write
      // so we don't create an empty commit, but report success.
      if (JSON.stringify(updated) === JSON.stringify(current)) {
        getLogger().info("Consistency fix was a no-op (already applied)", context)
        return NextResponse.json({ success: true, applyTo, noop: true })
      }

      await saveComponent(updated, sha)
      getLogger().info("Consistency fix applied", context)
      return NextResponse.json({ success: true, applyTo })
    } catch (error) {
      getLogger().error("Failed to apply consistency fix", {
        ...context,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json(
        {
          error: `Failed to apply fix: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        },
        { status: 500 }
      )
    }
  })
}
