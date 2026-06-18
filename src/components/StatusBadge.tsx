"use client"

import { Badge } from "@/components/ui/badge"
import { STATUS_COLORS } from "@/lib/constants"
import type { ComponentStatus } from "@/lib/types"

export function StatusBadge({ status }: { status: ComponentStatus }) {
  return (
    <Badge variant="outline" className={STATUS_COLORS[status]}>
      {status}
    </Badge>
  )
}
