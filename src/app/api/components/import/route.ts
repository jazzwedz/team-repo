// POST /api/components/import
//
// Imports one or many components from YAML. Accepts either a single
// component document or a multi-doc bundle (`---` separated) — the same
// shape produced by the catalog YAML export.
//
// Conflict handling (when an incoming id already exists) is controlled
// by `onConflict`:
//   - "update" (default) — overwrite the existing component wholesale.
//   - "merge"            — PARTIAL import: keep the existing component
//                          and override only the top-level fields the
//                          patch provides (e.g. just `nfr`). Requires an
//                          `id` that matches an existing component.
//   - "create"           — keep both: auto-append `-2`, `-3`, … to the
//                          incoming id (capped at -99).
//   - "skip"             — leave the existing component untouched.
//
// "update" / "create" / "skip" also handle the no-conflict case by
// creating the component. "merge" only patches an existing one and
// errors when the target id is not found.
//
// Returns a per-document report plus a summary. For a single applied
// document the final id is also surfaced at the top level so the client
// can redirect straight to its edit page.
//
// Note: bulk import does NOT gate on edit locks (it is an admin-style
// operation); the provider's sha-based concurrency check is the safety
// net for the "update" / "merge" paths.

import { NextResponse } from "next/server"
import { listComponents, getComponent, saveComponent } from "@/lib/github"
import {
  validateComponentDocs,
  validateComponentObject,
  loadYamlDocs,
  type ValidationIssue,
} from "@/lib/component-schema"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

const COLLISION_CAP = 99

type ConflictMode = "update" | "merge" | "create" | "skip"
const CONFLICT_MODES: ConflictMode[] = ["update", "merge", "create", "skip"]

interface ImportBody {
  yaml?: string
  onConflict?: string
}

type ImportAction = "created" | "updated" | "merged" | "renamed" | "skipped" | "error"

interface ImportResult {
  index: number
  id: string
  finalId?: string
  name?: string
  action: ImportAction
  /** For merge: the top-level fields the patch overrode. */
  fields?: string[]
  warnings: ValidationIssue[]
  issues?: ValidationIssue[]
  error?: string
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

export async function POST(request: Request) {
  return withRouteContext(request, async () => {
    let body: ImportBody
    try {
      body = (await request.json()) as ImportBody
    } catch {
      return NextResponse.json({ error: "Body must be JSON." }, { status: 400 })
    }

    if (typeof body.yaml !== "string" || body.yaml.trim() === "") {
      return NextResponse.json(
        { error: "Missing field `yaml` — paste the component YAML in the request body." },
        { status: 400 }
      )
    }

    const onConflict: ConflictMode = CONFLICT_MODES.includes(body.onConflict as ConflictMode)
      ? (body.onConflict as ConflictMode)
      : "update"

    // Snapshot existing ids once for collision / merge-target detection.
    let ids: Set<string>
    try {
      const existing = await listComponents()
      ids = new Set(existing.map((c) => c.id))
    } catch (err) {
      getLogger().error("Failed to list components for import", {
        err: err instanceof Error ? err.message : String(err),
      })
      return NextResponse.json(
        { error: "Could not read existing components. Try again." },
        { status: 500 }
      )
    }

    const results: ImportResult[] =
      onConflict === "merge"
        ? await runMerge(body.yaml, ids)
        : await runFullImport(body.yaml, ids, onConflict)

    const summary = {
      total: results.length,
      created: results.filter((r) => r.action === "created").length,
      updated: results.filter((r) => r.action === "updated").length,
      merged: results.filter((r) => r.action === "merged").length,
      renamed: results.filter((r) => r.action === "renamed").length,
      skipped: results.filter((r) => r.action === "skipped").length,
      errors: results.filter((r) => r.action === "error").length,
    }

    getLogger().info("Component import", { onConflict, ...summary })

    const applied = summary.created + summary.updated + summary.merged + summary.renamed

    // Nothing applied and every document errored → 400 so the dialog
    // shows the validation/save problems (mirrors the old single-import
    // behaviour). Surface the first failing document's issues at the top
    // level for convenience.
    if (applied === 0 && summary.errors > 0) {
      const firstError = results.find((r) => r.action === "error")
      return NextResponse.json(
        {
          success: false,
          error: firstError?.error || "Import failed",
          issues: firstError?.issues,
          warnings: firstError?.warnings,
          results,
          summary,
        },
        { status: 400 }
      )
    }

    // Single applied document → surface its final id for redirect.
    const appliedResults = results.filter((r) =>
      ["created", "updated", "merged", "renamed"].includes(r.action)
    )
    const singleId = appliedResults.length === 1 ? appliedResults[0].finalId : undefined

    return NextResponse.json({
      success: true,
      id: singleId,
      results,
      summary,
    })
  })
}

// ---- full import: create / update / skip --------------------------------

async function runFullImport(
  yamlText: string,
  ids: Set<string>,
  onConflict: Exclude<ConflictMode, "merge">
): Promise<ImportResult[]> {
  const validated = validateComponentDocs(yamlText)
  const results: ImportResult[] = []

  for (let i = 0; i < validated.length; i++) {
    const v = validated[i]

    if (!v.ok) {
      results.push({
        index: i,
        id: "",
        action: "error",
        warnings: v.warnings,
        issues: v.errors,
        error: "Validation failed",
      })
      continue
    }

    const component = v.value
    const warnings = v.warnings

    try {
      if (!ids.has(component.id)) {
        await saveComponent(component)
        ids.add(component.id)
        results.push({
          index: i,
          id: component.id,
          finalId: component.id,
          name: component.name,
          action: "created",
          warnings,
        })
        continue
      }

      if (onConflict === "skip") {
        results.push({
          index: i,
          id: component.id,
          name: component.name,
          action: "skipped",
          warnings,
        })
        continue
      }

      if (onConflict === "update") {
        const existing = await getComponent(component.id)
        await saveComponent(component, existing.sha)
        results.push({
          index: i,
          id: component.id,
          finalId: component.id,
          name: component.name,
          action: "updated",
          warnings,
        })
        continue
      }

      // onConflict === "create": find a free `-N` id.
      let n = 2
      while (n <= COLLISION_CAP && ids.has(`${component.id}-${n}`)) n++
      if (n > COLLISION_CAP) {
        results.push({
          index: i,
          id: component.id,
          name: component.name,
          action: "error",
          warnings,
          error: `No free id after ${component.id}-${COLLISION_CAP}. Edit the id and retry.`,
        })
        continue
      }
      const finalId = `${component.id}-${n}`
      const originalId = component.id
      component.id = finalId
      await saveComponent(component)
      ids.add(finalId)
      results.push({
        index: i,
        id: originalId,
        finalId,
        name: component.name,
        action: "renamed",
        warnings,
      })
    } catch (err) {
      getLogger().error("Failed to import component", {
        id: component.id,
        err: err instanceof Error ? err.message : String(err),
      })
      results.push({
        index: i,
        id: component.id,
        name: component.name,
        action: "error",
        warnings,
        error: err instanceof Error ? err.message : "Save failed",
      })
    }
  }

  return results
}

// ---- partial import: merge patch fields onto an existing component ------
//
// Each patch must carry an `id` of an existing component. The patch's
// top-level fields override the existing ones (shallow — providing
// `nfr` replaces the whole nfr block; absent fields are untouched). The
// MERGED object is then run through the full validator, so all field
// rules still apply, and saved with the existing sha.

async function runMerge(yamlText: string, ids: Set<string>): Promise<ImportResult[]> {
  const loaded = loadYamlDocs(yamlText)
  if (!loaded.ok) {
    return [{ index: 0, id: "", action: "error", warnings: [], error: loaded.error }]
  }
  if (loaded.docs.length === 0) {
    return [{ index: 0, id: "", action: "error", warnings: [], error: "Empty YAML." }]
  }

  const results: ImportResult[] = []

  for (let i = 0; i < loaded.docs.length; i++) {
    const raw = loaded.docs[i]

    if (!isPlainObject(raw)) {
      results.push({
        index: i,
        id: "",
        action: "error",
        warnings: [],
        error: "Each document must be a YAML object.",
      })
      continue
    }

    const id = typeof raw.id === "string" ? raw.id.trim() : ""
    if (!id) {
      results.push({
        index: i,
        id: "",
        action: "error",
        warnings: [],
        error: "Merge requires an `id` matching an existing component.",
      })
      continue
    }

    if (!ids.has(id)) {
      results.push({
        index: i,
        id,
        action: "error",
        warnings: [],
        error: `No component with id "${id}" to merge into. Use Update or Create to add it.`,
      })
      continue
    }

    // Fields the patch overrides (excluding identity / housekeeping keys).
    const fields = Object.keys(raw).filter(
      (k) => k !== "id" && k !== "schema_version"
    )
    if (fields.length === 0) {
      results.push({
        index: i,
        id,
        action: "error",
        warnings: [],
        error: "Patch has no fields to merge (only `id` was provided).",
      })
      continue
    }

    try {
      const existing = await getComponent(id)
      const { sha, ...existingComp } = existing

      // Shallow override: existing as the base, patch fields on top.
      const merged: Record<string, unknown> = { ...existingComp }
      for (const k of Object.keys(raw)) {
        if (k === "schema_version") continue // stamped on save
        merged[k] = raw[k]
      }
      merged.id = id

      const v = validateComponentObject(merged)
      if (!v.ok) {
        results.push({
          index: i,
          id,
          action: "error",
          warnings: v.warnings,
          issues: v.errors,
          error: "Merged component failed validation",
        })
        continue
      }

      await saveComponent(v.value, sha)
      results.push({
        index: i,
        id,
        finalId: id,
        name: v.value.name,
        action: "merged",
        fields,
        warnings: v.warnings,
      })
    } catch (err) {
      getLogger().error("Failed to merge component", {
        id,
        err: err instanceof Error ? err.message : String(err),
      })
      results.push({
        index: i,
        id,
        action: "error",
        warnings: [],
        error: err instanceof Error ? err.message : "Merge save failed",
      })
    }
  }

  return results
}
