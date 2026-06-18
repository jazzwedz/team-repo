// Compute a "documentation maturity" score for a component.
// Equal weight per field; the % is rendered next to the identity panel
// to show users what they still have to fill in.

import type { Component } from "./types"

export interface MaturityField {
  key: string
  label: string
  filled: boolean
}

export interface MaturityResult {
  fields: MaturityField[]
  filled: number
  total: number
  percent: number
  bandLabel: "Skeletal" | "Drafted" | "Solid" | "Complete"
  bandColor: string
}

export function computeMaturity(component: Component): MaturityResult {
  const fields: MaturityField[] = [
    {
      key: "oneliner",
      label: "One-line summary",
      filled: !!component.description?.oneliner?.trim(),
    },
    {
      // Unified description (v0.6+). For legacy components that still
      // hold only technical / business we count the field as filled when
      // either of them has content, so existing maturity scores do not
      // regress on the migration boundary.
      key: "description",
      label: "Description",
      filled: !!(
        component.description?.description?.trim() ||
        component.description?.technical?.trim() ||
        component.description?.business?.trim()
      ),
    },
    {
      key: "owner",
      label: "Owner",
      filled: !!component.owner?.trim(),
    },
    {
      key: "tags",
      label: "Tags",
      filled: (component.tags || []).length > 0,
    },
    {
      key: "capabilities",
      label: "Capabilities",
      filled: (component.capabilities || []).length > 0,
    },
    {
      key: "links",
      label: "Links (relationships & interfaces)",
      filled: (component.links || []).length > 0,
    },
    {
      key: "nfr",
      label: "Non-functional requirements",
      filled:
        !!component.nfr &&
        Object.values(component.nfr).some((v) => !!v),
    },
    {
      key: "risks",
      label: "Risks",
      filled: (component.risks || []).length > 0,
    },
    {
      key: "rules",
      label: "Rules & calculations",
      filled: (component.rules || []).length > 0,
    },
  ]
  const filled = fields.filter((f) => f.filled).length
  const total = fields.length
  const percent = Math.round((filled / total) * 100)

  // 0–25 Skeletal, 26–55 Drafted, 56–85 Solid, 86–100 Complete
  let bandLabel: MaturityResult["bandLabel"] = "Skeletal"
  let bandColor = "bg-red-500"
  if (percent >= 86) {
    bandLabel = "Complete"
    bandColor = "bg-emerald-500"
  } else if (percent >= 56) {
    bandLabel = "Solid"
    bandColor = "bg-blue-500"
  } else if (percent >= 26) {
    bandLabel = "Drafted"
    bandColor = "bg-amber-500"
  }

  return { fields, filled, total, percent, bandLabel, bandColor }
}
