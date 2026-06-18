"use client"

// Dual-provenance display — shows a rule/capability/link's "requested"
// (spec) facet next to its "implemented" (code) facet, with a drift badge
// and the code evidence (path, line range, snippet, deep link). Read-only;
// the facets are populated by the code-aware agent and approved by the
// analyst. Generic so rules, capabilities and links can all reuse it: the
// caller supplies the comparable rows; the panel renders the layout.

import { Badge } from "@/components/ui/badge"
import { FileCode2, ExternalLink } from "lucide-react"
import type { Reconciliation, SpecSource, CodeEvidence } from "@/lib/types"

export interface ProvenanceRow {
  label: string
  value: string
}

const RECON: Record<Reconciliation, { label: string; className: string }> = {
  consistent: { label: "Consistent", className: "text-emerald-700 border-emerald-300 bg-emerald-50" },
  divergent: { label: "Divergent", className: "text-rose-700 border-rose-300 bg-rose-50" },
  "requested-only": { label: "Requested only", className: "text-amber-700 border-amber-300 bg-amber-50" },
  "implemented-only": { label: "Implemented only", className: "text-blue-700 border-blue-300 bg-blue-50" },
}

function Rows({ rows }: { rows: ProvenanceRow[] }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground italic">(none)</p>
  return (
    <div className="space-y-1">
      {rows.map((r, i) => (
        <div key={i} className="text-xs">
          <span className="font-medium text-foreground/70">{r.label}: </span>
          <span className="text-foreground/90">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

export function ProvenancePanel({
  reconciliation,
  requested,
  implemented,
}: {
  reconciliation?: Reconciliation
  requested?: { rows: ProvenanceRow[]; source?: SpecSource }
  implemented?: { rows: ProvenanceRow[]; evidence?: CodeEvidence }
}) {
  if (!requested && !implemented) return null
  const recon = reconciliation ? RECON[reconciliation] : null
  const ev = implemented?.evidence

  return (
    <div className="mt-3 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Requested vs implemented
        </span>
        {recon && (
          <Badge variant="outline" className={`text-[10px] ${recon.className}`}>
            {recon.label}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Requested (spec) */}
        <div className="rounded border bg-white p-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-1">
            Requested (spec)
          </div>
          {requested ? <Rows rows={requested.rows} /> : <p className="text-xs text-muted-foreground italic">(not in spec)</p>}
          {requested?.source && (
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {requested.source.doc || "spec"}
              {typeof requested.source.page === "number" ? ` · p.${requested.source.page}` : ""}
              {requested.source.quote ? `: “${requested.source.quote}”` : ""}
            </p>
          )}
        </div>

        {/* Implemented (code) */}
        <div className="rounded border bg-white p-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700 mb-1">
            Implemented (code)
          </div>
          {implemented ? <Rows rows={implemented.rows} /> : <p className="text-xs text-muted-foreground italic">(not found in code)</p>}
          {ev && (
            <div className="mt-1.5">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <FileCode2 className="h-3 w-3 shrink-0" />
                <span className="font-mono break-all">
                  {ev.path}
                  {typeof ev.lineStart === "number"
                    ? `:${ev.lineStart}${typeof ev.lineEnd === "number" && ev.lineEnd !== ev.lineStart ? `-${ev.lineEnd}` : ""}`
                    : ""}
                </span>
                {ev.url && (
                  <a
                    href={ev.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-700 hover:underline inline-flex items-center gap-0.5 shrink-0"
                  >
                    view <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
              {ev.snippet && (
                <pre className="mt-1 text-[11px] font-mono bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                  {ev.snippet}
                </pre>
              )}
              {(ev.ref || ev.capturedAt) && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  captured{ev.ref ? ` @ ${ev.ref}` : ""}
                  {ev.capturedAt ? ` · ${ev.capturedAt.slice(0, 10)}` : ""}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
