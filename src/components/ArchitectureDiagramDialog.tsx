"use client"

// Architecture overview — a full-catalog mermaid diagram in a modal.
//
// Opens on the catalog header. Toggles let the analyst dial in which
// edge sources to include (relationships / interfaces) and whether to
// nest components inside their container's frame (Group by hierarchy —
// Context ⊃ microservices ⊃ modules, etc.). The chart re-renders
// instantly when a toggle flips — building it is pure
// string-concatenation in src/lib/architecture-mermaid.ts.
//
// Two side-actions live in the footer:
//   - Copy Mermaid source — useful for pasting into mermaid.live or
//     any markdown doc.
//   - The dialog body itself scrolls in both axes for large catalogs;
//     no built-in zoom (would require touching MermaidPreview).

import { useEffect, useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Network, Loader2, AlertCircle, Copy, Check } from "lucide-react"
import { MermaidPreview } from "@/components/mermaid-preview"
import { buildArchitectureMermaid } from "@/lib/architecture-mermaid"
import type { Component } from "@/lib/types"
import { useStoredState } from "@/lib/use-stored-state"

export function ArchitectureDiagramDialog() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [components, setComponents] = useState<Component[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Toggle preferences persist per browser — analysts usually have a
  // standard view they want and should not re-tick everything on each
  // visit.
  const [showRelationships, setShowRelationships] = useStoredState(
    "arch:showRelationships",
    true
  )
  const [showInterfaces, setShowInterfaces] = useStoredState(
    "arch:showInterfaces",
    true
  )
  const [groupByContainment, setGroupByContainment] = useStoredState(
    "arch:groupByContainment",
    true
  )

  // Fetch fresh on every dialog open so an architecture change made in
  // another tab is reflected immediately. Closing the dialog throws the
  // result away so the next open starts clean.
  useEffect(() => {
    if (!open) {
      setComponents([])
      setLoadError(null)
      return
    }
    setLoading(true)
    setLoadError(null)
    fetch("/api/components")
      .then(async (r) => {
        const data = await r.json().catch(() => null)
        if (!r.ok) {
          const msg =
            data && typeof data === "object" && "error" in data
              ? String(data.error)
              : `Request failed (${r.status})`
          throw new Error(msg)
        }
        return data
      })
      .then((data) => setComponents(Array.isArray(data) ? data : []))
      .catch((err: Error) => setLoadError(err.message || "Failed to load"))
      .finally(() => setLoading(false))
  }, [open])

  const chart = useMemo(
    () =>
      buildArchitectureMermaid(components, {
        showRelationships,
        showInterfaces,
        groupByContainment,
      }),
    [components, showRelationships, showInterfaces, groupByContainment]
  )

  const edgeCount = useMemo(() => {
    // One mermaid edge per line that contains "-->", "-.->", or "==>"
    return chart
      .split("\n")
      .filter((l) => /-->|-\.->|==>/.test(l)).length
  }, [chart])

  const copySource = () => {
    if (!chart) return
    navigator.clipboard.writeText(chart).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Network className="h-4 w-4 mr-2" />
          Architecture overview
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] max-h-[95vh] w-[95vw] h-[95vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Network className="h-5 w-5 text-blue-600" />
            Architecture overview
          </DialogTitle>
          <DialogDescription>
            Every component in the catalog and the edges between them. Use the
            toggles to switch edge sources on and off.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-3 border-b shrink-0 flex items-center justify-between flex-wrap gap-3 bg-muted/30">
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <Toggle
              label="Relationships"
              checked={showRelationships}
              onChange={setShowRelationships}
            />
            <Toggle
              label="Interfaces"
              checked={showInterfaces}
              onChange={setShowInterfaces}
            />
            <span className="h-4 w-px bg-border" />
            <Toggle
              label="Group by hierarchy"
              checked={groupByContainment}
              onChange={setGroupByContainment}
            />
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {!loading && !loadError && (
              <span>
                <strong>{components.length}</strong> components ·{" "}
                <strong>{edgeCount}</strong> edges
              </span>
            )}
            <Button variant="outline" size="sm" onClick={copySource} disabled={!chart || loading}>
              {copied ? (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3 mr-1" />
                  Copy Mermaid
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-4 py-4 bg-white">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading catalog…
            </div>
          )}
          {!loading && loadError && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {loadError}
            </div>
          )}
          {!loading && !loadError && components.length > 0 && (
            <div className="min-w-full">
              <MermaidPreview chart={chart} className="w-full" />
            </div>
          )}
          {!loading && !loadError && components.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No components in the catalog yet.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5"
      />
      <span>{label}</span>
    </label>
  )
}
