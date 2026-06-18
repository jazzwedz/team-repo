"use client"

import { useEffect, useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Upload,
  Trash2,
  FileImage,
  Loader2,
  Download,
  ArrowLeft,
  Eye,
  X,
  Pencil,
} from "lucide-react"
import Link from "next/link"
import type { DiagramWithSha } from "@/lib/types"
import { drawioToMermaid } from "@/lib/drawio-preview"
import { MermaidPreview } from "@/components/mermaid-preview"
import { DrawioLibraryDialog } from "@/components/DrawioLibraryDialog"

export default function DiagramsPage() {
  const [previewName, setPreviewName] = useState<string | null>(null)
  const [diagrams, setDiagrams] = useState<DiagramWithSha[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deletingName, setDeletingName] = useState<string | null>(null)
  const [previewDiagram, setPreviewDiagram] = useState<DiagramWithSha | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchDiagrams = () => {
    fetch("/api/diagrams")
      .then(async (r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`)
        return r.json()
      })
      .then((data) => setDiagrams(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error("Failed to load diagrams:", err)
        setDiagrams([])
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchDiagrams()
    // Read ?preview=<name> from the URL once on mount (used when arriving
    // from a "Diagrams referencing this component" link). Avoids
    // useSearchParams to keep this page compatible with static
    // pre-rendering.
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search)
      setPreviewName(params.get("preview"))
    }
  }, [])

  // Auto-open preview modal when previewName is present and diagrams loaded.
  useEffect(() => {
    if (!previewName || diagrams.length === 0) return
    const match = diagrams.find((d) => d.name === previewName)
    if (match) setPreviewDiagram(match)
  }, [previewName, diagrams])

  const handleUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".drawio")) {
      alert("Only .drawio files are allowed.")
      return
    }
    setUploading(true)
    try {
      const content = await file.text()
      const name = file.name.replace(/\.drawio$/i, "")

      const res = await fetch("/api/diagrams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content }),
      })

      if (!res.ok) throw new Error("Failed to upload")
      fetchDiagrams()
    } catch (err) {
      console.error("Upload failed:", err)
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (diagram: DiagramWithSha) => {
    setDeletingName(diagram.name)
    try {
      const res = await fetch(`/api/diagrams/${diagram.name}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha: diagram.sha }),
      })

      if (!res.ok) throw new Error("Failed to delete")
      setDiagrams((prev) => prev.filter((d) => d.name !== diagram.name))
    } catch (err) {
      console.error("Delete failed:", err)
    } finally {
      setDeletingName(null)
    }
  }

  const handleDownload = (diagram: DiagramWithSha) => {
    const blob = new Blob([diagram.content], { type: "application/xml" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${diagram.name}.drawio`
    a.click()
    URL.revokeObjectURL(url)
  }

  const previewChart = previewDiagram
    ? drawioToMermaid(previewDiagram.content)
    : null

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold">Architecture Diagrams</h1>
          <p className="text-muted-foreground mt-1">
            Upload and manage Draw.io architecture diagrams stored in the
            repository
          </p>
        </div>
        <DrawioLibraryDialog />
        <Link href="/diagrams/builder">
          <Button>
            <Pencil className="h-4 w-4 mr-2" />
            Diagram Builder
          </Button>
        </Link>
      </div>

      {/* Upload area */}
      <Card className="max-w-2xl">
        <CardContent className="pt-6">
          <label className="flex flex-col items-center justify-center gap-3 p-8 rounded-md border-2 border-dashed cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors">
            {uploading ? (
              <Loader2 className="h-10 w-10 text-muted-foreground animate-spin" />
            ) : (
              <Upload className="h-10 w-10 text-muted-foreground" />
            )}
            <div className="text-center">
              <p className="text-sm font-medium">
                {uploading ? "Uploading..." : "Click to upload a diagram"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Only .drawio files are supported
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".drawio"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleUpload(file)
                e.target.value = ""
              }}
            />
          </label>
        </CardContent>
      </Card>

      {/* Diagrams list */}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileImage className="h-5 w-5" />
            Stored Diagrams
            {!loading && (
              <span className="text-sm font-normal text-muted-foreground">
                ({diagrams.length})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">
              Loading diagrams...
            </p>
          ) : diagrams.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No diagrams uploaded yet.
            </p>
          ) : (
            <div className="space-y-2">
              {diagrams.map((d) => (
                <div
                  key={d.name}
                  className="flex items-center gap-3 p-3 rounded-md border hover:bg-muted/50 transition-colors"
                >
                  <FileImage className="h-5 w-5 text-muted-foreground shrink-0" />
                  <span className="font-mono text-sm flex-1">
                    {d.name}.drawio
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {(d.content.length / 1024).toFixed(1)} KB
                  </span>
                  <Link href={`/diagrams/builder?load=${encodeURIComponent(d.name)}`}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Edit in Builder"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setPreviewDiagram(d)}
                    title="Preview"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleDownload(d)}
                    title="Download"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(d)}
                    disabled={deletingName === d.name}
                    title="Delete"
                  >
                    {deletingName === d.name ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Diagram preview modal */}
      <Dialog
        open={!!previewDiagram}
        onOpenChange={(open) => !open && setPreviewDiagram(null)}
      >
        <DialogContent className="max-w-6xl h-[90vh] flex flex-col p-0 [&>button:last-child]:hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b shrink-0 bg-gray-50">
            <div className="flex items-center gap-2">
              <FileImage className="h-5 w-5" />
              <DialogTitle className="text-lg font-semibold">
                {previewDiagram?.name}.drawio
              </DialogTitle>
              <span className="text-xs text-muted-foreground ml-2">
                Simplified preview (mermaid)
              </span>
            </div>
            <div className="flex items-center gap-2">
              {previewDiagram && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownload(previewDiagram)}
                >
                  <Download className="h-4 w-4 mr-1" />
                  Download
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPreviewDiagram(null)}
              >
                <X className="h-4 w-4 mr-1" />
                Close
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden bg-white">
            {previewChart ? (
              <MermaidPreview chart={previewChart} />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Could not parse diagram for preview. Download the .drawio file to view it in Draw.io.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
