// Validators for AI-proposed patch values. Used by /api/confluence/pull-smart
// to check enum-constrained fields before committing to the catalog.

import type { DataClassification, ScalingModel } from "./types"
import { DATA_CLASSIFICATION_LABELS } from "./constants"

// Resolve a Data Classification value (label like "Confidential" or raw key
// like "confidential") to a canonical DataClassification.
//   undefined  → empty input (intent: clear the field)
//   null       → invalid value
//   otherwise  → the canonical key
export function resolveDataClassification(
  raw: string
): DataClassification | undefined | null {
  const t = raw.trim()
  if (!t) return undefined
  const lower = t.toLowerCase()
  const canon = (Object.keys(DATA_CLASSIFICATION_LABELS) as DataClassification[]).find(
    (k) => k === lower || DATA_CLASSIFICATION_LABELS[k].toLowerCase() === lower
  )
  return canon ?? null
}

export function resolveScaling(raw: string): ScalingModel | undefined | null {
  const t = raw.trim()
  if (!t) return undefined
  const lower = t.toLowerCase()
  const valid: ScalingModel[] = ["horizontal", "vertical", "none"]
  return valid.includes(lower as ScalingModel) ? (lower as ScalingModel) : null
}
