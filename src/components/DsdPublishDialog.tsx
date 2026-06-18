"use client"

// Publish a DSD to Confluence (one-way). The analyst picks a parent page
// — the "sub-directory" the DSD lives under — from a dropdown of the
// space's pages. The chosen parent and the resulting page URL are
// remembered on the artifact, so re-opening pre-selects the parent and the
// page is updated in place rather than duplicated.

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, ExternalLink, AlertCircle, Check } from "lucide-react"
import { renderDsdDiagramImages } from "@/lib/mermaid-to-png"

interface PageNode {
  id: string
  title: string
  parentId: string | null
}

interface FlatNode {
  id: string
  title: string
  depth: number
}

export interface DsdPublishResult {
  pageId: string
  pageUrl: string
  parentId: string
  parentTitle?: string
  action: "created" | "updated"
}

function buildTree(pages: PageNode[]): FlatNode[] {
  const byParent = new Map<string | null, PageNode[]>()
  for (const p of pages) {
    const k = p.parentId ?? null
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(p)
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.title.localeCompare(b.title))
  }
  const out: FlatNode[] = []
  const seen = new Set<string>()
  const visit = (parentId: string | null, depth: number) => {
    for (const n of byParent.get(parentId) || []) {
      if (seen.has(n.id)) continue
      seen.add(n.id)
      out.push({ id: n.id, title: n.title, depth })
      visit(n.id, depth + 1)
    }
  }
  visit(null, 0)
  // Pages whose parent is outside the fetched set surface at the root.
  for (const p of pages) {
    if (!seen.has(p.id)) {
      seen.add(p.id)
      out.push({ id: p.id, title: p.title, depth: 0 })
    }
  }
  return out
}

export function DsdPublishDialog({
  open,
  onOpenChange,
  solutionId,
  artifactId,
  currentParentId,
  currentPageUrl,
  onPublished,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  solutionId: string
  artifactId: string
  currentParentId?: string | null
  currentPageUrl?: string
  onPublished?: (result: DsdPublishResult) => void
}) {
  const [loading, setLoading] = useState(false)
  const [configured, setConfigured] = useState(true)
  const [pages, setPages] = useState<FlatNode[]>([])
  const [parentId, setParentId] = useState<string>(currentParentId || "")
  const [error, setError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(currentPageUrl || null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setResultUrl(currentPageUrl || null)
    setParentId(currentParentId || "")
    setLoading(true)
    fetch("/api/confluence/pages")
      .then(async (r) => {
        const d = await r.json().catch(() => null)
        if (!d) throw new Error("Failed to load Confluence pages")
        setConfigured(!!d.configured)
        setPages(buildTree(Array.isArray(d.pages) ? d.pages : []))
        if (d.error) setError(d.error)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load pages"))
      .finally(() => setLoading(false))
  }, [open, currentParentId, currentPageUrl])

  const publish = async () => {
    if (!parentId) {
      setError("Pick a parent page first.")
      return
    }
    setPublishing(true)
    setError(null)
    try {
      // Render the DSD's mermaid diagrams to PNG in the browser, so they can
      // be attached to the Confluence page (no mermaid plugin needed there).
      // Best-effort: if it fails, publish the text without the diagrams.
      let images: { filename: string; base64: string }[] = []
      try {
        setStatusMsg("Rendering diagrams…")
        const ar = await fetch(
          `/api/solutions/${encodeURIComponent(solutionId)}/dsd/artifacts/${encodeURIComponent(artifactId)}`
        ).then((res) => res.json()).catch(() => null)
        if (ar?.markdown) images = await renderDsdDiagramImages(ar.markdown)
      } catch {
        /* publish text-only if diagram rendering fails */
      }
      setStatusMsg("Publishing…")
      const parentTitle = pages.find((p) => p.id === parentId)?.title
      const r = await fetch(
        `/api/solutions/${encodeURIComponent(solutionId)}/dsd/artifacts/${encodeURIComponent(artifactId)}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parentId, parentTitle, images }),
        }
      )
      const d = await r.json().catch(() => null)
      if (!r.ok || !d) {
        setError((d && d.error) || `Publish failed (${r.status})`)
        return
      }
      setResultUrl(d.pageUrl)
      onPublished?.({
        pageId: d.pageId,
        pageUrl: d.pageUrl,
        parentId,
        parentTitle,
        action: d.action,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed")
    } finally {
      setPublishing(false)
      setStatusMsg(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Publish DSD to Confluence</DialogTitle>
          <DialogDescription>
            Pick the parent page to publish this DSD under. The choice is
            remembered for this DSD; re-publishing updates the same page.
          </DialogDescription>
        </DialogHeader>

        {!configured ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            Confluence is not configured. Set the <code>CONFLUENCE_*</code> env
            vars to enable publishing.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Parent page (directory)</label>
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading space pages…
                </div>
              ) : (
                <Select value={parentId} onValueChange={setParentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a parent page…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {pages.length === 0 ? (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">
                        No pages found in the space.
                      </div>
                    ) : (
                      pages.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <span style={{ paddingLeft: `${p.depth * 12}px` }}>
                            {p.depth > 0 ? "↳ " : ""}
                            {p.title}
                          </span>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>

            {resultUrl && (
              <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                <div className="flex items-center gap-2 font-medium">
                  <Check className="h-4 w-4" />
                  Published
                </div>
                <a
                  href={resultUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 break-all text-green-800 underline"
                >
                  {resultUrl}
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </a>
              </div>
            )}

            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={publish} disabled={publishing || loading || !parentId}>
                {publishing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {statusMsg || "Publishing…"}
                  </>
                ) : (
                  "Publish"
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
