"use client"

// Form card — map this component to its source code in the configured
// source repository (Azure DevOps, read-only). The listed paths are read
// at DSD generation time and fed to the writers as authoritative evidence
// for functional requirements, data structures and embedded logic.
//
// Hidden entirely when the source-code connection is not configured on the
// deployment (SRC_ADO_* env), so teams not using it see no clutter. The
// connection is set up under Settings → Health checks → "Source code (ADO)".
//
// Persists as `source.paths` on the component YAML. MVP reads from the
// single configured source repo; per-component repo override is reserved.

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { FileCode } from "lucide-react"
import type { ComponentSource } from "@/lib/types"

interface Props {
  source: ComponentSource | undefined
  onChange: (source: ComponentSource | undefined) => void
}

export function SourceCodeCard({ source, onChange }: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [draft, setDraft] = useState((source?.paths || []).join("\n"))

  useEffect(() => {
    setDraft((source?.paths || []).join("\n"))
  }, [source])

  useEffect(() => {
    let cancelled = false
    fetch("/api/source-code/status")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setConfigured(!!d.configured)
      })
      .catch(() => {
        if (!cancelled) setConfigured(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Hidden until we know it's configured (avoids a flash) and when off.
  if (configured !== true) return null

  const commit = (text: string) => {
    setDraft(text)
    const paths = text
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean)
    if (paths.length === 0) {
      // Preserve any reserved repo override; otherwise clear the field.
      onChange(source?.repo ? { repo: source.repo } : undefined)
    } else {
      onChange({ ...(source?.repo ? { repo: source.repo } : {}), paths })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileCode className="h-4 w-4 text-muted-foreground" />
          Source code
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Optional. List the files in the connected source repository that
          implement this component — one path per line. They are read
          (read-only) and used as grounding when generating a DSD, so the
          Functional Requirements and Data Structures reflect the real code.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor="source-paths">File paths</Label>
        <Textarea
          id="source-paths"
          value={draft}
          onChange={(e) => commit(e.target.value)}
          rows={4}
          placeholder={"src/orders/pricing_engine.py\nsrc/orders/rules/discount.py"}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          Paths relative to the source repo root. Saved as
          <code className="font-mono"> source.paths</code> on the component YAML.
        </p>
      </CardContent>
    </Card>
  )
}
