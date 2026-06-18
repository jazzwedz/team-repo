"use client"

import { TYPE_ICONS } from "@/lib/constants"
import type { ComponentType } from "@/lib/types"
import { cn } from "@/lib/utils"

export function TypeIcon({
  type,
  className,
  style,
}: {
  type: ComponentType
  className?: string
  style?: React.CSSProperties
}) {
  const Icon = TYPE_ICONS[type]
  return <Icon className={cn("h-5 w-5", className)} style={style} />
}
