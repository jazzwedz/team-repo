"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MermaidPreview } from "@/components/mermaid-preview"
import { TypeIcon } from "@/components/TypeIcon"
import { StatusBadge } from "@/components/StatusBadge"
import { LINK_ROLE_LABELS } from "@/lib/constants"
import {
  AlertTriangle,
  Sparkles,
  Loader2,
  Users,
  ShieldAlert,
  FileWarning,
  ArrowRight,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type {
  BlastRadiusResult,
  ImpactedComponent,
  ImpactSeverity,
} from "@/lib/blast-radius"

/**
 * Inline body view of the blast radius — used directly in the Blast Radius
 * tab on the component detail page. Shares the same fetch/render logic as
 * BlastRadiusDialog but without the Dialog wrapper.
 *
 * Pass `active` to defer the fetch until the tab becomes visible.
 */
export function BlastRadiusView({
  componentId,
  active = true,
}: {
  componentId: string
  active?: boolean
}) {
  const [data, setData] = useState<BlastRadiusResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [memo, setMemo] = useState<string | null>(null)
  const [memoLoading, setMemoLoading] = useState(false)
  const [memoError, setMemoError] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    setData(null)
    setMemo(null)
    setError(null)
    setMemoError(null)
    setLoading(true)
    fetch(`/api/components/${componentId}/blast-radius`)
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}))
          throw new Error(err.error || "Failed to compute blast radius")
        }
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Unknown error"))
      .finally(() => setLoading(false))
  }, [active, componentId])

  const generateMemo = async () => {
    if (!data) return
    setMemoLoading(true)
    setMemoError(null)
    try {
      const res = await fetch(
        `/api/components/${componentId}/blast-radius/memo`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to generate memo")
      }
      const json = await res.json()
      setMemo(json.memo)
    } catch (e) {
      setMemoError(e instanceof Error ? e.message : "Unknown error")
    } finally {
      setMemoLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          Blast Radius — {data?.source.name || "..."}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          What would be affected if this component fails, changes, or is removed.
        </p>
      </div>

      {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Walking the dependency graph...
            </span>
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 text-destructive text-sm rounded-md p-3">
            {error}
          </div>
        )}

        {data && !loading && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                label="Directly impacted"
                value={data.directCount}
                icon={<Users className="h-4 w-4" />}
                tone={data.directCount > 0 ? "warning" : "muted"}
              />
              <StatCard
                label="Transitively impacted"
                value={data.transitiveCount}
                icon={<ArrowRight className="h-4 w-4" />}
                tone={data.transitiveCount > 0 ? "info" : "muted"}
              />
              <StatCard
                label="Production-status"
                value={data.productionImpacted}
                icon={<AlertTriangle className="h-4 w-4" />}
                tone={data.productionImpacted > 0 ? "danger" : "muted"}
              />
              <StatCard
                label="NFR gaps (no RTO)"
                value={data.nfrGaps}
                icon={<FileWarning className="h-4 w-4" />}
                tone={data.nfrGaps > 0 ? "warning" : "muted"}
              />
            </div>

            {data.confidentialDataAffected > 0 && (
              <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                <span>
                  <strong>{data.confidentialDataAffected}</strong> impacted
                  component{data.confidentialDataAffected === 1 ? "" : "s"} handle
                  confidential or restricted data.
                </span>
              </div>
            )}

            {data.totalImpacted === 0 ? (
              <div className="rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                No components depend on <strong>{data.source.name}</strong>. Blast
                radius is zero — nothing else in the catalog references it.
              </div>
            ) : (
              <>
                <div className="rounded-md border bg-white p-4">
                  <h3 className="text-sm font-medium mb-3 text-muted-foreground">
                    Impact graph
                  </h3>
                  <MermaidPreview chart={data.mermaid} />
                </div>

                {data.layers.map((layer) => (
                  <div key={layer.depth}>
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      {layer.depth === 1
                        ? "Direct impact"
                        : `Transitive (level ${layer.depth})`}
                      <span className="text-xs text-muted-foreground font-normal">
                        ({layer.components.length} component
                        {layer.components.length === 1 ? "" : "s"})
                      </span>
                    </h3>
                    <div className="space-y-1.5">
                      {layer.components.map((c) => (
                        <ImpactRow key={c.id} c={c} />
                      ))}
                    </div>
                  </div>
                ))}

                <div className="border-t pt-4">
                  {memo ? (
                    <div className="rounded-md border bg-muted/20 p-4">
                      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-orange-500" />
                        AI Impact Memo
                      </h3>
                      <div className="prose prose-sm max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {memo}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-start gap-2">
                      <Button
                        onClick={generateMemo}
                        disabled={memoLoading}
                        className="bg-orange-500 hover:bg-orange-600 text-white"
                      >
                        {memoLoading ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Generating impact memo...
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4 mr-2" />
                            Generate AI Impact Memo
                          </>
                        )}
                      </Button>
                      {memoError && (
                        <div className="text-sm text-destructive">{memoError}</div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
    </div>
  )
}

/**
 * Modal wrapper around BlastRadiusView. Kept for backward compatibility with
 * any callers that still want the dialog form. The detail page now uses
 * BlastRadiusView directly inside its Blast Radius tab.
 */
export function BlastRadiusDialog({
  open,
  onOpenChange,
  componentId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  componentId: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">Blast Radius</DialogTitle>
          <DialogDescription className="sr-only">
            What would be affected if this component fails, changes, or is removed.
          </DialogDescription>
        </DialogHeader>
        <BlastRadiusView componentId={componentId} active={open} />
      </DialogContent>
    </Dialog>
  )
}

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string
  value: number
  icon: React.ReactNode
  tone: "danger" | "warning" | "info" | "muted"
}) {
  const styles = {
    danger: "border-red-200 bg-red-50 text-red-900",
    warning: "border-orange-200 bg-orange-50 text-orange-900",
    info: "border-blue-200 bg-blue-50 text-blue-900",
    muted: "border-gray-200 bg-gray-50 text-gray-700",
  }[tone]
  return (
    <div className={`rounded-md border p-3 ${styles}`}>
      <div className="flex items-center gap-2 text-xs opacity-80">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  )
}

function ImpactRow({ c }: { c: ImpactedComponent }) {
  const sevColor =
    c.severity === "high"
      ? "border-orange-300 bg-orange-50"
      : c.severity === "medium"
      ? "border-yellow-300 bg-yellow-50"
      : "border-gray-200 bg-gray-50"
  return (
    <div
      className={`flex flex-wrap items-center gap-2 text-sm rounded-md border p-2 ${sevColor}`}
    >
      <TypeIcon type={c.type} className="h-4 w-4 shrink-0" />
      <a
        href={`/component/${c.id}`}
        className="font-medium hover:underline"
      >
        {c.name}
      </a>
      <Badge variant="outline" className="text-xs">
        {LINK_ROLE_LABELS[c.via.role] || c.via.role}
      </Badge>
      {c.via.protocol && (
        <Badge variant="secondary" className="text-[10px]">
          {c.via.protocol}
        </Badge>
      )}
      {c.via.fromComponent && (
        <span className="text-xs text-muted-foreground">
          via {c.via.fromComponent}
        </span>
      )}
      <StatusBadge status={c.status} />
      {c.owner && (
        <span className="text-xs text-muted-foreground">{c.owner}</span>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        {c.nfrGap && (
          <Badge className="bg-orange-100 text-orange-800 border-orange-300 text-xs hover:bg-orange-100">
            No RTO
          </Badge>
        )}
        {c.hasConfidentialData && (
          <Badge className="bg-red-100 text-red-800 border-red-300 text-xs hover:bg-red-100">
            Confidential
          </Badge>
        )}
        <SeverityBadge severity={c.severity} />
      </div>
    </div>
  )
}

function SeverityBadge({ severity }: { severity: ImpactSeverity }) {
  const cls =
    severity === "high"
      ? "bg-orange-500 text-white hover:bg-orange-500"
      : severity === "medium"
      ? "bg-yellow-500 text-white hover:bg-yellow-500"
      : "bg-gray-300 text-gray-700 hover:bg-gray-300"
  return <Badge className={`${cls} text-xs uppercase`}>{severity}</Badge>
}
