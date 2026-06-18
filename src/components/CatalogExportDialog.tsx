"use client"

// Catalog Export dialog — renders the LLM-friendly markdown for the
// whole catalog and offers copy / download / preview. Built on top of
// the same buildCatalogMarkdown function the API route uses.
//
// The dialog runs the build CLIENT-SIDE so opening it does not hit a
// route at all; the only network call is fetching /api/components.
// That keeps the dialog responsive and lets the preview re-render
// instantly when (future) toggles for verbosity / format land.

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
import {
  FileDown,
  Loader2,
  AlertCircle,
  Copy,
  Check,
  Download,
} from "lucide-react"
import { buildCatalogMarkdown } from "@/lib/catalog-export"
import type { Component } from "@/lib/types"

export function CatalogExportDialog() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [components, setComponents] = useState<Component[]>([])
  const [copied, setCopied] = useState(false)
  const [generatedAt, setGeneratedAt] = useState<string>("")

  // Fetch fresh on every dialog open.
  useEffect(() => {
    if (!open) {
      setComponents([])
      setError(null)
      setGeneratedAt("")
      return
    }
    setLoading(true)
    setError(null)
    setGeneratedAt(new Date().toISOString())
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
      .catch((err: Error) => setError(err.message || "Failed to load"))
      .finally(() => setLoading(false))
  }, [open])

  const markdown = useMemo(
    () => buildCatalogMarkdown(components, { generatedAt }),
    [components, generatedAt]
  )

  const sizeKb = useMemo(
    () => Math.round((new Blob([markdown]).size / 1024) * 10) / 10,
    [markdown]
  )

  const copyAll = () => {
    if (!markdown) return
    navigator.clipboard.writeText(markdown).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  const download = () => {
    if (!markdown) return
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    const date = generatedAt.slice(0, 10) || "unknown"
    a.href = url
    a.download = `catalog-export-${date}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileDown className="h-4 w-4 mr-2" />
          Export for LLM
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] max-h-[95vh] w-[95vw] h-[95vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileDown className="h-5 w-5 text-blue-600" />
            Catalog export — LLM-friendly markdown
          </DialogTitle>
          <DialogDescription>
            Full catalog dump with every field of every component shown,
            including the empty ones (flagged explicitly with ❌). Paired
            with{" "}
            <code className="font-mono text-xs">docs/COMPONENT_MODEL.md</code>{" "}
            a model has everything it needs to audit, migrate, or extend
            the catalog.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-3 border-b shrink-0 flex items-center justify-between flex-wrap gap-3 bg-muted/30">
          <div className="text-sm text-muted-foreground">
            {!loading && !error && (
              <>
                <strong>{components.length}</strong> component
                {components.length === 1 ? "" : "s"} ·{" "}
                <strong>{sizeKb}</strong> KB markdown
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={copyAll}
              disabled={!markdown || loading}
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3 mr-1" />
                  Copy all
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={download}
              disabled={!markdown || loading}
            >
              <Download className="h-3 w-3 mr-1" />
              Download .md
            </Button>
            <a
              href="/api/admin/export-catalog"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-700 underline hover:no-underline"
              title="Open the raw export URL (also usable from curl)"
            >
              Raw URL
            </a>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-zinc-50">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground px-6 py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading catalog…
            </div>
          )}
          {!loading && error && (
            <div className="m-6 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}
          {!loading && !error && (
            <pre className="text-xs font-mono whitespace-pre-wrap px-6 py-4 leading-relaxed">
              {markdown}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
