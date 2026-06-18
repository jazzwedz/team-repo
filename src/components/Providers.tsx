"use client"

import { TooltipProvider } from "@/components/ui/tooltip"
import { UIConfigProvider } from "@/components/UIConfigProvider"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <UIConfigProvider>
      <TooltipProvider>{children}</TooltipProvider>
    </UIConfigProvider>
  )
}
