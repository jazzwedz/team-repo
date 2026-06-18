"use client"

// Catalog YAML export — one-click download of the whole catalog as a
// single round-trippable multi-doc YAML bundle. Re-importable via the
// Import dialog. Builds the bundle client-side from /api/components, the
// same data source the LLM export dialog uses.

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { FileCode2, Loader2 } from "lucide-react"
import { catalogToYaml } from "@/lib/component-yaml"
import type { Component } from "@/lib/types"

export function ExportYamlButton() {
  const [loading, setLoading] = useState(false)

  const run = async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/components")
      const data = await r.json().catch(() => null)
      if (!r.ok) {
        const msg =
          data && typeof data === "object" && "error" in data
            ? String((data as { error: unknown }).error)
            : `Request failed (${r.status})`
        throw new Error(msg)
      }
      const components: Component[] = Array.isArray(data) ? data : []
      const yaml = catalogToYaml(components)
      const blob = new Blob([yaml], { type: "application/x-yaml;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      const date = new Date().toISOString().slice(0, 10)
      a.href = url
      a.download = `catalog-${date}.yaml`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      // Surface failures without a modal — keep the header lightweight.
      alert(`Export failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" onClick={run} disabled={loading}>
      {loading ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <FileCode2 className="h-4 w-4 mr-2" />
      )}
      Export YAML
    </Button>
  )
}
