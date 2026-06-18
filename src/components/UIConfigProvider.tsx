"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react"
import type { UIBlocksConfig } from "@/lib/ui-blocks"

interface UIConfigState {
  blocks: UIBlocksConfig
  loaded: boolean
  refresh: () => Promise<void>
}

const UIConfigContext = createContext<UIConfigState>({
  blocks: {},
  loaded: false,
  refresh: async () => {},
})

export function UIConfigProvider({ children }: { children: ReactNode }) {
  const [blocks, setBlocks] = useState<UIBlocksConfig>({})
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/config", { cache: "no-store" })
      if (!res.ok) {
        setBlocks({})
        return
      }
      const data = (await res.json()) as { ui?: { blocks?: UIBlocksConfig } }
      setBlocks(data.ui?.blocks || {})
    } catch {
      setBlocks({})
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <UIConfigContext.Provider value={{ blocks, loaded, refresh }}>
      {children}
    </UIConfigContext.Provider>
  )
}

export function useUIConfig(): UIConfigState {
  return useContext(UIConfigContext)
}
