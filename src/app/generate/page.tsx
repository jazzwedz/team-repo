"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AgentRunModal } from "@/components/AgentRunModal"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  ArrowLeft,
  FileText,
  Loader2,
  FileImage,
  Download,
  Copy,
  Check,
  X,
  Upload,
  Trash2,
  Eye,
  EyeOff,
  Send,
  ExternalLink,
} from "lucide-react"
import Link from "next/link"
import type { Component, DiagramWithSha } from "@/lib/types"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import yaml from "js-yaml"
import { drawioToMermaid } from "@/lib/drawio-preview"
import { MermaidPreview } from "@/components/mermaid-preview"

type GenerateResult = {
  generated?: string
  confluenceUrl?: string
  pdfUrl?: string
  message?: string
  timeout?: boolean
  error?: string
}

type MatchedComponent = {
  archId: string
  component: Component | null
}

type SelectionMode = "none" | "component" | "diagram"
type OutputMode = "audience" | "doctype"
type DocumentType = "detailed-solution" | "audit-report" | "security-report"

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  "detailed-solution": "Detailed Solution Description",
  "audit-report": "Audit Report",
  "security-report": "Security Report",
}

export default function GeneratePage() {
  const [components, setComponents] = useState<Component[]>([])
  const [diagrams, setDiagrams] = useState<DiagramWithSha[]>([])
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("none")
  const [selectedComponentId, setSelectedComponentId] = useState<string>("")
  const [selectedDiagramName, setSelectedDiagramName] = useState<string>("")
  const [outputMode, setOutputMode] = useState<OutputMode>("audience")
  const [audience, setAudience] = useState<string>("Technical")
  const [documentType, setDocumentType] = useState<DocumentType>("detailed-solution")
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<GenerateResult | null>(null)
  const [matchedComponents, setMatchedComponents] = useState<
    MatchedComponent[]
  >([])
  const [analyzing, setAnalyzing] = useState(false)
  const [componentDiagrams, setComponentDiagrams] = useState<string[]>([])
  const [showDocModal, setShowDocModal] = useState(false)
  const [copied, setCopied] = useState(false)
  const [expandedDiagram, setExpandedDiagram] = useState<string | null>(null)
  const [bizReqFile, setBizReqFile] = useState<{ name: string; content: string } | null>(null)
  const [erdFile, setErdFile] = useState<{ name: string; content: string } | null>(null)
  const [bpmnFile, setBpmnFile] = useState<{ name: string; content: string } | null>(null)
  const docContentRef = useRef<HTMLDivElement>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<
    | { ok: true; pageUrl: string; action: string; capabilityParent: string; warning?: string }
    | { ok: false; error: string }
    | null
  >(null)

  useEffect(() => {
    fetch("/api/components")
      .then(async (r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`)
        return r.json()
      })
      .then((data) => setComponents(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load components:", err))

    fetch("/api/diagrams")
      .then(async (r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`)
        return r.json()
      })
      .then((data) => setDiagrams(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load diagrams:", err))
  }, [])

  const selectedComponent = components.find(
    (c) => c.id === selectedComponentId
  )

  const handleModeChange = (mode: string) => {
    setSelectionMode(mode as SelectionMode)
    setSelectedComponentId("")
    setSelectedDiagramName("")
    setMatchedComponents([])
    setComponentDiagrams([])
    setResult(null)
  }

  const handleComponentSelect = (id: string) => {
    setSelectedComponentId(id)
    setMatchedComponents([])
    setResult(null)

    // Search all diagrams for this component
    if (id) {
      const found = diagrams
        .filter((d) => d.content.includes(`arch_id="${id}"`))
        .map((d) => d.name)
      setComponentDiagrams(found)
    } else {
      setComponentDiagrams([])
    }
  }

  const handleDiagramSelect = async (name: string) => {
    setSelectedDiagramName(name)
    setMatchedComponents([])
    setResult(null)

    if (!name) return

    setAnalyzing(true)
    try {
      const res = await fetch(`/api/diagrams/${encodeURIComponent(name)}`)
      if (!res.ok) throw new Error("Failed to fetch diagram")
      const diagram: DiagramWithSha = await res.json()

      // Parse arch_id attributes from diagram XML
      const archIdRegex = /arch_id="([^"]+)"/g
      const foundIds = new Set<string>()
      let match
      while ((match = archIdRegex.exec(diagram.content)) !== null) {
        foundIds.add(match[1])
      }

      const matched: MatchedComponent[] = Array.from(foundIds).map(
        (archId) => ({
          archId,
          component: components.find((c) => c.id === archId) || null,
        })
      )

      setMatchedComponents(matched)
    } catch (err) {
      console.error("Failed to analyze diagram:", err)
    } finally {
      setAnalyzing(false)
    }
  }

  const handleAttachment = async (
    file: File,
    allowedExt: string,
    setter: (val: { name: string; content: string } | null) => void
  ) => {
    const ext = file.name.toLowerCase().split(".").pop()
    if (ext !== allowedExt) {
      alert(`Only .${allowedExt} files are accepted.`)
      return
    }
    const content = await file.text()
    setter({ name: file.name, content })
  }

  const handleGenerate = async () => {
    if (selectionMode === "component" && !selectedComponent) return
    if (selectionMode === "diagram" && !selectedDiagramName) return

    setGenerating(true)
    setResult(null)

    try {
      let body: Record<string, unknown>

      const attachments: Record<string, string> = {}
      if (bizReqFile) attachments.businessRequirement = bizReqFile.content
      if (erdFile) attachments.dataModel = erdFile.content
      if (bpmnFile) attachments.processModel = bpmnFile.content

      const outputSpec = outputMode === "audience"
        ? { audience }
        : { audience: "Technical", documentType: documentType, documentTypeLabel: DOCUMENT_TYPE_LABELS[documentType] }

      if (selectionMode === "component" && selectedComponent) {
        const yamlContent = yaml.dump(selectedComponent)
        body = {
          componentId: selectedComponentId,
          ...outputSpec,
          yamlContent,
          attachments,
        }
      } else {
        body = {
          diagramName: selectedDiagramName,
          ...outputSpec,
          componentsYaml: matchedComponents
            .filter((m) => m.component)
            .map((m) => yaml.dump(m.component!))
            .join("\n---\n"),
          attachments,
        }
      }

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const data = await response.json()
      setResult(data)
      if (data.generated) setShowDocModal(true)
    } catch {
      setResult({ error: "Failed to trigger generation. Check console." })
    } finally {
      setGenerating(false)
    }
  }

  const handleSavePdf = useCallback(() => {
    if (!docContentRef.current) return
    const content = docContentRef.current.innerHTML
    const rawTitle =
      selectionMode === "component" && selectedComponent
        ? selectedComponent.name
        : selectedDiagramName
    const title = (rawTitle || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

    const printWindow = window.open("", "_blank")
    if (!printWindow) return

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>${title} - Architecture Documentation</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; line-height: 1.6; }
    h1 { font-size: 24px; border-bottom: 2px solid #333; padding-bottom: 8px; }
    h2 { font-size: 20px; margin-top: 24px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    h3 { font-size: 16px; margin-top: 20px; }
    p { margin: 8px 0; }
    ul, ol { padding-left: 24px; }
    li { margin: 4px 0; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 13px; }
    pre { background: #f4f4f4; padding: 16px; border-radius: 6px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f4f4f4; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>${content}</body>
</html>`)
    printWindow.document.close()
    printWindow.onload = () => {
      printWindow.print()
    }
  }, [selectionMode, selectedComponent, selectedDiagramName])

  const handleCopyMarkdown = useCallback(() => {
    if (!result?.generated) return
    navigator.clipboard.writeText(result.generated).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [result])

  const handlePublishToConfluence = useCallback(async () => {
    if (!result?.generated || !selectedComponentId) return
    setPublishing(true)
    setPublishResult(null)
    try {
      const audienceLabel =
        outputMode === "audience" ? audience : DOCUMENT_TYPE_LABELS[documentType]
      const res = await fetch("/api/confluence/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          componentId: selectedComponentId,
          audienceLabel,
          narrativeMarkdown: result.generated,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setPublishResult({ ok: false, error: json.error || `HTTP ${res.status}` })
      } else {
        setPublishResult({
          ok: true,
          pageUrl: json.pageUrl,
          action: json.action,
          capabilityParent: json.capabilityParent,
          warning: json.warning,
        })
      }
    } catch (e) {
      setPublishResult({
        ok: false,
        error: e instanceof Error ? e.message : "Unknown error",
      })
    } finally {
      setPublishing(false)
    }
  }, [result, selectedComponentId, outputMode, audience, documentType])

  const getDescription = (component: Component): string => {
    const d = component.description || {}
    // Unified description (preferred). Falls back to the legacy
    // technical / business split for components that have not been
    // re-saved since the v0.6 migration.
    const unified = d.description || ""
    if (audience === "Executive") return d.oneliner || unified || d.business || d.technical || ""
    if (audience === "Business") return d.business || unified || d.technical || ""
    return d.technical || unified || d.business || ""
  }

  const hasSelection =
    (selectionMode === "component" && selectedComponentId) ||
    (selectionMode === "diagram" && selectedDiagramName)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Generate Documentation</h1>
          <p className="text-muted-foreground mt-1">
            Instant, always up-to-date architecture insights — generated directly from your live catalog
          </p>
        </div>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Generation Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Source selection */}
          <div className="space-y-2">
            <Label>Source</Label>
            <Select
              value={selectionMode === "none" ? "" : selectionMode}
              onValueChange={handleModeChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select source type..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="component">Component</SelectItem>
                <SelectItem value="diagram">Diagram</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Component selector */}
          {selectionMode === "component" && (
            <div className="space-y-2">
              <Label>Component</Label>
              <Select
                value={selectedComponentId}
                onValueChange={handleComponentSelect}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select component..." />
                </SelectTrigger>
                <SelectContent>
                  {components.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({c.id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Diagram selector */}
          {selectionMode === "diagram" && (
            <div className="space-y-2">
              <Label>Diagram</Label>
              <Select
                value={selectedDiagramName}
                onValueChange={handleDiagramSelect}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select diagram..." />
                </SelectTrigger>
                <SelectContent>
                  {diagrams.length === 0 ? (
                    <SelectItem value="_none" disabled>
                      No diagrams available
                    </SelectItem>
                  ) : (
                    diagrams.map((d) => (
                      <SelectItem key={d.name} value={d.name}>
                        {d.name}.drawio
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Output mode */}
          <div className="space-y-2">
            <Label>Output</Label>
            <Select value={outputMode} onValueChange={(v) => setOutputMode(v as OutputMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="audience">By Audience</SelectItem>
                <SelectItem value="doctype">Document Type</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Audience selector */}
          {outputMode === "audience" && (
            <div className="space-y-2">
              <Label>Audience</Label>
              <Select value={audience} onValueChange={setAudience}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Technical">Technical</SelectItem>
                  <SelectItem value="Business">Business</SelectItem>
                  <SelectItem value="Executive">Executive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Document type selector */}
          {outputMode === "doctype" && (
            <div className="space-y-2">
              <Label>Document Type</Label>
              <Select value={documentType} onValueChange={(v) => setDocumentType(v as DocumentType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="detailed-solution">Detailed Solution Description</SelectItem>
                  <SelectItem value="audit-report">Audit Report</SelectItem>
                  <SelectItem value="security-report">Security Report</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Optional attachments */}
          <div className="space-y-3 pt-2 border-t">
            <Label className="text-muted-foreground text-xs uppercase tracking-wide">
              Optional context (not stored, used only for generation)
            </Label>

            {/* Business Requirement */}
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Business Requirement</p>
                <p className="text-xs text-muted-foreground">Only .pdf files</p>
              </div>
              {bizReqFile ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono truncate max-w-[160px]">{bizReqFile.name}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setBizReqFile(null)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <label className="cursor-pointer">
                  <Button variant="outline" size="sm" asChild>
                    <span><Upload className="h-3.5 w-3.5 mr-1" />Attach</span>
                  </Button>
                  <input
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) handleAttachment(f, "pdf", setBizReqFile)
                      e.target.value = ""
                    }}
                  />
                </label>
              )}
            </div>

            {/* Data Model (ERD) */}
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Data Model</p>
                <p className="text-xs text-muted-foreground">Only .erd files (ERD format)</p>
              </div>
              {erdFile ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono truncate max-w-[160px]">{erdFile.name}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setErdFile(null)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <label className="cursor-pointer">
                  <Button variant="outline" size="sm" asChild>
                    <span><Upload className="h-3.5 w-3.5 mr-1" />Attach</span>
                  </Button>
                  <input
                    type="file"
                    accept=".erd"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) handleAttachment(f, "erd", setErdFile)
                      e.target.value = ""
                    }}
                  />
                </label>
              )}
            </div>

            {/* Process Model (BPMN) */}
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Process Model</p>
                <p className="text-xs text-muted-foreground">Only .bpmn files (BPMN format)</p>
              </div>
              {bpmnFile ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono truncate max-w-[160px]">{bpmnFile.name}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setBpmnFile(null)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <label className="cursor-pointer">
                  <Button variant="outline" size="sm" asChild>
                    <span><Upload className="h-3.5 w-3.5 mr-1" />Attach</span>
                  </Button>
                  <input
                    type="file"
                    accept=".bpmn"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) handleAttachment(f, "bpmn", setBpmnFile)
                      e.target.value = ""
                    }}
                  />
                </label>
              )}
            </div>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={!hasSelection || generating}
            className={`w-full ${generating ? "bg-teal-500 hover:bg-teal-600 text-white" : ""}`}
          >
            {generating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileText className="h-4 w-4 mr-2" />
            )}
            {generating ? "Generating..." : "Generate"}
          </Button>

          {result?.error && (
            <div className="mt-4 p-4 rounded-md border bg-muted/50">
              <p className="text-destructive text-sm">{result.error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <AgentRunModal
        open={generating}
        title="Documentation writer"
        nodes={[{ label: "Documentation writer", icon: "✍️" }]}
        stages={[
          "Reading the component and its links…",
          "Structuring the document for the audience…",
          "Writing clear, grounded prose…",
          "Polishing and formatting…",
        ]}
      />

      {/* Component detail */}
      {selectionMode === "component" && selectedComponent && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {selectedComponent.name}
              <Badge variant="secondary" className="text-xs">
                {selectedComponent.type}
              </Badge>
              <span className="text-xs text-muted-foreground font-mono font-normal">
                {selectedComponent.id}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {getDescription(selectedComponent)}
            </p>
            <div>
              <p className="text-sm font-medium mb-2 flex items-center gap-2">
                <FileImage className="h-4 w-4" />
                Appears in diagrams
              </p>
              {componentDiagrams.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This component does not appear in any diagram.
                </p>
              ) : (
                <div className="space-y-2">
                  {componentDiagrams.map((name) => {
                    const diagram = diagrams.find((d) => d.name === name)
                    const chart = diagram ? drawioToMermaid(diagram.content, selectedComponentId) : null
                    const isExpanded = expandedDiagram === name
                    return (
                      <div key={name} className="rounded-md border overflow-hidden">
                        <div className="flex items-center gap-2 p-2 text-sm hover:bg-muted/50 transition-colors">
                          <FileImage className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-mono flex-1">{name}.drawio</span>
                          {chart && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setExpandedDiagram(isExpanded ? null : name)}
                              title={isExpanded ? "Hide preview" : "Show preview"}
                            >
                              {isExpanded ? (
                                <EyeOff className="h-3.5 w-3.5" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          )}
                        </div>
                        {isExpanded && chart && (
                          <div className="border-t bg-white p-4">
                            <MermaidPreview chart={chart} className="max-h-[400px]" />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Diagram analysis results */}
      {selectionMode === "diagram" && selectedDiagramName && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileImage className="h-5 w-5" />
              Diagram Analysis: {selectedDiagramName}.drawio
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analyzing ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing diagram...
              </div>
            ) : matchedComponents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No catalog components found in this diagram.
              </p>
            ) : (
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground mb-3">
                  This diagram contains{" "}
                  <strong>{matchedComponents.length}</strong> component
                  {matchedComponents.length !== 1 ? "s" : ""} from the catalog:
                </p>
                <div className="space-y-3">
                  {matchedComponents.map((m) => (
                    <div
                      key={m.archId}
                      className="p-3 rounded-md border hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">
                          {m.component ? m.component.name : m.archId}
                        </span>
                        {m.component ? (
                          <Badge variant="secondary" className="text-xs">
                            {m.component.type}
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">
                            not in catalog
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground font-mono">
                          {m.archId}
                        </span>
                      </div>
                      {m.component && (
                        <p className="text-sm text-muted-foreground">
                          {getDescription(m.component)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Generated documentation modal */}
      <Dialog open={showDocModal} onOpenChange={setShowDocModal}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 [&>button:last-child]:hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b shrink-0 bg-gray-50">
            <DialogHeader className="flex-1">
              <DialogTitle className="flex items-center gap-3">
                <FileText className="h-5 w-5" />
                <span>
                  {selectionMode === "component" && selectedComponent
                    ? selectedComponent.name
                    : selectedDiagramName}
                </span>
                <span className="inline-flex items-center px-3 py-1 rounded text-xs font-semibold bg-gray-900 text-white uppercase tracking-wide">
                  {outputMode === "audience" ? audience : DOCUMENT_TYPE_LABELS[documentType]}
                </span>
              </DialogTitle>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyMarkdown}
              >
                {copied ? (
                  <Check className="h-4 w-4 mr-1" />
                ) : (
                  <Copy className="h-4 w-4 mr-1" />
                )}
                {copied ? "Copied" : "Copy Markdown"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleSavePdf}>
                <Download className="h-4 w-4 mr-1" />
                Save as PDF
              </Button>
              {selectionMode === "component" && selectedComponentId && (
                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={handlePublishToConfluence}
                  disabled={publishing}
                  title="Publish to Confluence (Team Repository space)"
                >
                  {publishing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Publishing...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-1" />
                      Publish to Confluence
                    </>
                  )}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowDocModal(false)
                  setPublishResult(null)
                }}
              >
                <X className="h-4 w-4 mr-1" />
                Close
              </Button>
            </div>
          </div>
          {publishResult && (
            <div
              className={`px-6 py-3 border-b text-sm ${
                publishResult.ok
                  ? "bg-green-50 border-green-200 text-green-900"
                  : "bg-red-50 border-red-200 text-red-900"
              }`}
            >
              {publishResult.ok ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-4">
                    <span>
                      Published to Confluence ({publishResult.action}) under
                      capability <strong>{publishResult.capabilityParent}</strong>.
                    </span>
                    <a
                      href={publishResult.pageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 underline font-medium"
                    >
                      Open in Confluence
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                  {publishResult.warning && (
                    <div className="text-xs text-amber-700">
                      Note: {publishResult.warning}
                    </div>
                  )}
                </div>
              ) : (
                <span>Publish failed: {publishResult.error}</span>
              )}
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-8 py-6 bg-white">
            <div
              ref={docContentRef}
              className="max-w-none
                [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:border-b-2 [&_h1]:border-gray-800 [&_h1]:pb-2 [&_h1]:mb-4 [&_h1]:text-gray-900
                [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:border-gray-300 [&_h2]:pb-1 [&_h2]:text-gray-800
                [&_h3]:text-base [&_h3]:font-bold [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-gray-700
                [&_p]:text-sm [&_p]:leading-relaxed [&_p]:my-2 [&_p]:text-gray-700
                [&_ul]:pl-6 [&_ul]:my-2 [&_ol]:pl-6 [&_ol]:my-2
                [&_li]:text-sm [&_li]:my-1 [&_li]:text-gray-700
                [&_code]:bg-gray-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:text-gray-800
                [&_pre]:bg-gray-100 [&_pre]:p-4 [&_pre]:rounded-md [&_pre]:overflow-x-auto [&_pre]:my-3
                [&_pre_code]:bg-transparent [&_pre_code]:p-0
                [&_table]:w-full [&_table]:border-collapse [&_table]:my-3
                [&_th]:border [&_th]:border-gray-300 [&_th]:bg-gray-100 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-sm [&_th]:font-semibold
                [&_td]:border [&_td]:border-gray-300 [&_td]:px-3 [&_td]:py-2 [&_td]:text-sm
                [&_strong]:font-semibold [&_strong]:text-gray-900
                [&_hr]:my-4 [&_hr]:border-gray-200"
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ className, children, ...props }) {
                    const isMermaid = /language-mermaid/.test(className || "")
                    if (isMermaid) {
                      return <MermaidPreview chart={String(children).trim()} />
                    }
                    const isInline = !className
                    if (isInline) {
                      return <code className={className} {...props}>{children}</code>
                    }
                    return (
                      <pre className="bg-gray-100 p-4 rounded-md overflow-x-auto my-3">
                        <code className={className} {...props}>{children}</code>
                      </pre>
                    )
                  },
                  pre({ children }) {
                    return <>{children}</>
                  },
                }}
              >{result?.generated ?? ""}</ReactMarkdown>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
