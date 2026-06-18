"use client"

import { useEffect, useState, useMemo } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TypeIcon } from "@/components/TypeIcon"
import { StatusBadge } from "@/components/StatusBadge"
import {
  TYPE_LABELS,
  LINK_ROLE_LABELS,
  INVERSE_LINK_ROLE_LABELS,
  LINK_ROLE_INVERSE,
  LINK_ROLE_COLORS,
  DATA_CLASSIFICATION_LABELS,
  CAPABILITY_ROLE_LABELS,
  CAPABILITY_ROLE_COLORS,
  RULE_KIND_LABELS,
  RULE_KIND_COLORS,
} from "@/lib/constants"
import type { ComponentWithSha, ComponentLink, LinkRole } from "@/lib/types"
import {
  ArrowLeft,
  Copy,
  Check,
  Pencil,
  ArrowRight,
  Download,
  Trash2,
  Info,
  History,
  ExternalLink,
  RefreshCw,
  Loader2,
  Eye,
  EyeOff,
  Sparkles,
  FileText,
  FileImage,
  FileCode2,
  Radar,
  X,
  Send,
} from "lucide-react"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
import { BlastRadiusView } from "@/components/BlastRadiusDialog"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MermaidPreview } from "@/components/mermaid-preview"
import {
  buildRelationshipsMermaid,
  buildCapabilitiesMermaid,
  buildHeroContextMermaid,
} from "@/lib/component-mermaid"
import { computeMaturity } from "@/lib/component-maturity"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import yaml from "js-yaml"
import { useUIConfig } from "@/components/UIConfigProvider"
import { isBlockVisible, isTabVisible, type DetailTabId } from "@/lib/ui-blocks"
import { RulesImportDialog } from "@/components/RulesImportDialog"
import { CodeRuleAuditDialog } from "@/components/CodeRuleAuditDialog"
import { SourceScanDialog } from "@/components/SourceScanDialog"
import { ProvenancePanel, type ProvenanceRow } from "@/components/ProvenancePanel"
import type { ComponentRule } from "@/lib/types"
import { DataModelEntityCard } from "@/components/DataModelEntityCard"
import { DrawioLibraryDialog } from "@/components/DrawioLibraryDialog"
import { BlockEditDialog } from "@/components/BlockEditDialog"
import { componentToYaml } from "@/lib/component-yaml"

// Map a rule's requested/implemented facet (same structured fields) to the
// comparable rows the ProvenancePanel renders side by side.
function ruleFacetRows(facet: {
  summary?: string
  formula?: string
  given?: string
  when?: string
  then?: string
}): ProvenanceRow[] {
  const rows: ProvenanceRow[] = []
  if (facet.summary) rows.push({ label: "Summary", value: facet.summary })
  if (facet.formula) rows.push({ label: "Formula", value: facet.formula })
  if (facet.given) rows.push({ label: "Given", value: facet.given })
  if (facet.when) rows.push({ label: "When", value: facet.when })
  if (facet.then) rows.push({ label: "Then", value: facet.then })
  return rows
}

export default function ComponentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [component, setComponent] = useState<ComponentWithSha | null>(null)
  // Lightweight refetch — used by BlockEditDialog after a per-block
  // save so the detail page picks up the new state without a full
  // route navigation.
  const refreshComponent = async () => {
    try {
      const r = await fetch(`/api/components/${id}`)
      if (!r.ok) return
      const fresh = (await r.json()) as ComponentWithSha
      setComponent(fresh)
    } catch {
      // Network blip — leave the in-page state alone; next nav will fix it.
    }
  }
  const [loading, setLoading] = useState(true)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [history, setHistory] = useState<{ sha: string; message: string; author: string; date: string }[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [confluence, setConfluence] = useState<{
    configured: boolean
    published: boolean
    pageUrl?: string
    pageId?: string
    lastSyncedAt?: string
  } | null>(null)
  type SmartPatch = {
    field: string
    oldValue: string
    newValue: string
    confidence: "high" | "medium" | "low"
    evidence?: string
  }
  const [pullState, setPullState] = useState<{
    loading: boolean
    patches?: SmartPatch[]
    selected: Record<number, boolean> // index → selected
    confluenceVersion?: number
    confluenceUrl?: string
    error?: string
    showDialog: boolean
    applying: boolean
    appliedCount?: number
  }>({ loading: false, showDialog: false, applying: false, selected: {} })

  // "Diagrams this component appears in"
  const [diagramRefs, setDiagramRefs] = useState<{ name: string }[] | null>(null)
  // Catalog snapshot used to render interface targets as clickable
  // links when the target matches a component id. Loaded once on
  // mount; fine for the detail page since the list is already shown
  // on the catalog landing page anyway.
  const [allComponents, setAllComponents] = useState<{ id: string; name: string; type: string }[]>([])
  // Distinct from `allComponents.length === 0` — the catalog might
  // genuinely have one component (this one). The flag tells the link
  // rows whether to render a "missing" warning or assume the lookup
  // is still loading and just show the raw target string.
  const [allComponentsLoaded, setAllComponentsLoaded] = useState(false)
  // Derived id → name lookup, handed to every mermaid builder so node
  // labels show the human-readable component name instead of the raw
  // YAML id. Recomputed when allComponents changes.
  const nameLookup = useMemo(
    () => new Map(allComponents.map((c) => [c.id, c.name])),
    [allComponents]
  )

  // v2 — inbound link backlinks. Single endpoint scans every
  // component's links[] looking for matches on `target === this.id`.
  // Replaces the legacy inbound-interfaces + inbound-relationships
  // pair (both now obsolete since v1 fields are dropped on save).
  type InboundLinkRef = {
    id: string
    name: string
    type: string
    link: ComponentLink
  }
  const [inboundLinks, setInboundLinks] = useState<InboundLinkRef[] | null>(null)
  // v2 Phase 2: data{} is gone — inputs/outputs are now reads-from /
  // writes-to links and their backlinks surface through inboundLinks
  // above. The old inbound-data endpoint and the InboundDataRef shape
  // are no longer used.

  // v2 — unified links list. Outbound (declared on this component)
  // PLUS inbound inverted (declared on other components, presented
  // from this side via INVERSE_LINK_ROLE_LABELS). Same dedup rule as
  // the previous combinedLinks: when both sides declared the
  // same logical edge (e.g. A.calls:B + B.serves:A) only one row is
  // shown, with the outbound side winning.
  type UnifiedLink = {
    target: string
    role: LinkRole
    displayLabel: string
    protocol?: string
    name?: string
    description?: string
    isInverse: boolean
    /** When inverse, the name of the component that declared it. */
    declaredOn?: string
  }
  const combinedLinks = useMemo<UnifiedLink[]>(() => {
    const isContain = (r: LinkRole) => r === "part-of" || r === "contains"
    // Identity for de-duping our OWN links: containment is unique per
    // target (name ignored); other roles keep protocol + name so two
    // genuine edges (e.g. two `reads-from` for different datasets) stay.
    const outKey = (r: LinkRole, target: string, protocol?: string, name?: string) =>
      isContain(r) ? `${r}::${target}` : `${r}::${target}::${protocol ?? ""}::${name ?? ""}`

    const seenOut = new Set<string>()
    const outbound: UnifiedLink[] = []
    for (const l of component?.links || []) {
      const k = outKey(l.role, l.target, l.protocol, l.name)
      if (seenOut.has(k)) continue // drop a duplicate link on this component
      seenOut.add(k)
      outbound.push({
        target: l.target,
        role: l.role,
        displayLabel: LINK_ROLE_LABELS[l.role] || l.role,
        protocol: l.protocol,
        name: l.name,
        description: l.description,
        isInverse: false,
      })
    }

    // Suppress an inbound edge when this component already declares its
    // mirror outbound (calls↔serves, part-of↔contains, reads-from↔
    // writes-to). The other side declared role R toward us; the mirror
    // we'd hold is LINK_ROLE_INVERSE[R] to the same target. If we have
    // it, the interaction is already on screen once — don't show it twice.
    const outRoleTarget = new Set(outbound.map((r) => `${r.role}::${r.target}`))
    const seenInv = new Set<string>()
    const filteredInverse: UnifiedLink[] = []
    for (const ref of inboundLinks || []) {
      const mirrorRole = LINK_ROLE_INVERSE[ref.link.role]
      if (mirrorRole && outRoleTarget.has(`${mirrorRole}::${ref.id}`)) continue
      // de-dupe inbound among themselves too
      const k = `${ref.link.role}::${ref.id}::${ref.link.protocol ?? ""}::${ref.link.name ?? ""}`
      if (seenInv.has(k)) continue
      seenInv.add(k)
      filteredInverse.push({
        target: ref.id,
        role: ref.link.role,
        displayLabel: INVERSE_LINK_ROLE_LABELS[ref.link.role] || ref.link.role,
        protocol: ref.link.protocol,
        name: ref.link.name,
        description: ref.link.description,
        isInverse: true,
        declaredOn: ref.name,
      })
    }
    return [...outbound, ...filteredInverse]
  }, [component, inboundLinks])
  // Per-section visualization toggles
  // v2: only one viz toggle now — the unified Links card uses the
  // existing setShowRelationshipsViz state for backward continuity.
  const [showRelationshipsViz, setShowRelationshipsViz] = useState(false)
  const [showCapabilitiesViz, setShowCapabilitiesViz] = useState(false)
  // Hero context diagram (Overview tab) — open by default for impact.
  const [showHeroDiagram, setShowHeroDiagram] = useState(true)
  // Active tab on the detail page.
  type DetailTab =
    | "overview"
    | "properties"
    | "rules"
    | "blast-radius"
    | "documentation"
    | "diagrams"
    | "history"
  const [tab, setTab] = useState<DetailTab>("overview")
  const [rulesImportOpen, setRulesImportOpen] = useState(false)
  const [codeAuditOpen, setCodeAuditOpen] = useState(false)
  const [sourceScanOpen, setSourceScanOpen] = useState(false)
  // Whether the source-code repo (SRC_ADO_*) is connected — drives whether
  // the "Check against code" button is offered at all.
  const [sourceConfigured, setSourceConfigured] = useState(false)
  useEffect(() => {
    fetch("/api/source-code/status")
      .then((r) => r.json())
      .then((d) => setSourceConfigured(!!d.configured))
      .catch(() => setSourceConfigured(false))
  }, [])
  const { blocks: uiBlocks } = useUIConfig()

  // If the active tab has been fully hidden via config, fall back to the
  // first visible one so the page never renders an empty body.
  useEffect(() => {
    if (isTabVisible(uiBlocks, tab as DetailTabId)) return
    const order: DetailTab[] = [
      "overview",
      "properties",
      "rules",
      "blast-radius",
      "documentation",
      "diagrams",
      "history",
    ]
    const fallback = order.find((t) => isTabVisible(uiBlocks, t as DetailTabId))
    if (fallback && fallback !== tab) setTab(fallback)
  }, [uiBlocks, tab])
  const [publishingStandalone, setPublishingStandalone] = useState(false)
  const [publishStandaloneStatus, setPublishStandaloneStatus] = useState<
    | { ok: true; pageUrl: string; action: string; capabilityParent: string; warning?: string }
    | { ok: false; error: string }
    | null
  >(null)
  // In-page documentation generator
  const [genAudience, setGenAudience] = useState<"Technical" | "Business" | "Executive">("Technical")
  const [genDocType, setGenDocType] = useState<
    "audience" | "detailed-solution" | "audit-report" | "security-report"
  >("audience")
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState<string | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [showDocModal, setShowDocModal] = useState(false)
  const [docCopied, setDocCopied] = useState(false)

  useEffect(() => {
    fetch(`/api/components/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found")
        return r.json()
      })
      .then(setComponent)
      .catch(() => router.push("/"))
      .finally(() => setLoading(false))

    fetch(`/api/components/${id}/history`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`)
        return r.json()
      })
      .then((data) => setHistory(Array.isArray(data) ? data : []))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false))

    fetch(`/api/confluence/status?componentId=${encodeURIComponent(id)}`)
      .then(async (r) => (r.ok ? r.json() : null))
      .then((data) => setConfluence(data))
      .catch(() => setConfluence(null))

    fetch(`/api/components/${encodeURIComponent(id)}/diagrams`)
      .then(async (r) => (r.ok ? r.json() : []))
      .then((data) => setDiagramRefs(Array.isArray(data) ? data : []))
      .catch(() => setDiagramRefs([]))

    // Catalog snapshot — used so interface-target strings can be
    // rendered as clickable links when they match a component id.
    fetch(`/api/components`)
      .then(async (r) => (r.ok ? r.json() : []))
      .then((data) => {
        setAllComponents(Array.isArray(data) ? data : [])
        setAllComponentsLoaded(true)
      })
      .catch(() => {
        setAllComponents([])
        setAllComponentsLoaded(true)
      })

    // v2 — single inbound-links endpoint replaces the legacy
    // inbound-interfaces + inbound-relationships pair.
    fetch(`/api/components/${encodeURIComponent(id)}/inbound-links`)
      .then(async (r) => (r.ok ? r.json() : []))
      .then((data) => setInboundLinks(Array.isArray(data) ? data : []))
      .catch(() => setInboundLinks([]))

  }, [id, router])

  const generateDocs = async () => {
    if (!component) return
    setGenerating(true)
    setGenError(null)
    setGenerated(null)
    try {
      const yamlContent = yaml.dump(component, { lineWidth: -1, sortKeys: false })
      const body: Record<string, unknown> = {
        componentId: component.id,
        yamlContent,
      }
      if (genDocType === "audience") {
        body.audience = genAudience
      } else {
        body.documentType = genDocType
        body.documentTypeLabel =
          genDocType === "detailed-solution"
            ? "Detailed Solution Description"
            : genDocType === "audit-report"
            ? "Audit Report"
            : "Security Report"
      }
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        setGenError(json.error || `HTTP ${res.status}`)
      } else {
        setGenerated(json.generated || "")
        setShowDocModal(true)
      }
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Unknown error")
    } finally {
      setGenerating(false)
    }
  }

  const copyDocMarkdown = () => {
    if (!generated) return
    navigator.clipboard.writeText(generated).then(() => {
      setDocCopied(true)
      setTimeout(() => setDocCopied(false), 2000)
    })
  }

  // Standalone "Publish to Confluence" — runs Generate (if needed) + Publish
  // in a single click. Used by the button on the Documentation tab.
  const publishToConfluenceStandalone = async () => {
    if (!component) return
    setPublishingStandalone(true)
    setPublishStandaloneStatus(null)
    try {
      // Step 1: ensure we have narrative content. If user already generated
      // something, reuse it; otherwise auto-generate using current selectors.
      let narrative = generated
      let audienceLabel: string =
        genDocType === "audience"
          ? genAudience
          : genDocType === "detailed-solution"
          ? "Detailed Solution Description"
          : genDocType === "audit-report"
          ? "Audit Report"
          : "Security Report"

      if (!narrative) {
        const yamlContent = yaml.dump(component, { lineWidth: -1, sortKeys: false })
        const body: Record<string, unknown> = {
          componentId: component.id,
          yamlContent,
        }
        if (genDocType === "audience") {
          body.audience = genAudience
        } else {
          body.documentType = genDocType
          body.documentTypeLabel = audienceLabel
        }
        const genRes = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const genJson = await genRes.json()
        if (!genRes.ok) {
          setPublishStandaloneStatus({
            ok: false,
            error: `Generate failed: ${genJson.error || `HTTP ${genRes.status}`}`,
          })
          return
        }
        narrative = genJson.generated || ""
        setGenerated(narrative)
        // Make audienceLabel reflect what we actually generated.
        audienceLabel = audienceLabel
      }

      // Step 2: publish.
      const res = await fetch("/api/confluence/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          componentId: component.id,
          audienceLabel,
          narrativeMarkdown: narrative,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setPublishStandaloneStatus({
          ok: false,
          error: json.error || `HTTP ${res.status}`,
        })
        return
      }
      setPublishStandaloneStatus({
        ok: true,
        pageUrl: json.pageUrl,
        action: json.action,
        capabilityParent: json.capabilityParent,
        warning: json.warning,
      })
      // Refresh confluence status so Open / Pull buttons appear.
      const status = await fetch(
        `/api/confluence/status?componentId=${encodeURIComponent(component.id)}`
      ).then((r) => (r.ok ? r.json() : null))
      if (status) setConfluence(status)
    } catch (e) {
      setPublishStandaloneStatus({
        ok: false,
        error: e instanceof Error ? e.message : "Unknown error",
      })
    } finally {
      setPublishingStandalone(false)
    }
  }

  const publishGeneratedToConfluence = async () => {
    if (!component || !generated) return
    try {
      const audienceLabel =
        genDocType === "audience"
          ? genAudience
          : genDocType === "detailed-solution"
          ? "Detailed Solution Description"
          : genDocType === "audit-report"
          ? "Audit Report"
          : "Security Report"
      const res = await fetch("/api/confluence/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          componentId: component.id,
          audienceLabel,
          narrativeMarkdown: generated,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(`Publish failed: ${json.error || `HTTP ${res.status}`}`)
      } else {
        // Refresh confluence status so the "Open in Confluence" button appears.
        const status = await fetch(
          `/api/confluence/status?componentId=${encodeURIComponent(component.id)}`
        ).then((r) => (r.ok ? r.json() : null))
        if (status) setConfluence(status)
        alert(`Published — open: ${json.pageUrl}`)
      }
    } catch (e) {
      alert(`Publish failed: ${e instanceof Error ? e.message : "Unknown error"}`)
    }
  }

  const fetchPullDiff = async () => {
    if (!component) return
    setPullState((s) => ({
      ...s,
      loading: true,
      error: undefined,
      showDialog: true,
      patches: undefined,
      appliedCount: undefined,
      selected: {},
    }))
    try {
      const res = await fetch("/api/confluence/pull-smart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ componentId: component.id, apply: false }),
      })
      const json = await res.json()
      if (!res.ok) {
        setPullState((s) => ({
          ...s,
          loading: false,
          error: json.error || `HTTP ${res.status}`,
        }))
      } else {
        const patches: SmartPatch[] = json.patches || []
        // Default-check: high or medium confidence proposals; low-confidence
        // proposals are surfaced but require explicit opt-in.
        const selected: Record<number, boolean> = {}
        patches.forEach((p, i) => {
          selected[i] = p.confidence !== "low"
        })
        setPullState((s) => ({
          ...s,
          loading: false,
          patches,
          confluenceVersion: json.confluenceVersion,
          confluenceUrl: json.confluenceUrl,
          error: undefined,
          selected,
        }))
      }
    } catch (e) {
      setPullState((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : "Unknown error",
      }))
    }
  }

  const applyPull = async () => {
    if (!component || !pullState.patches) return
    const chosen = pullState.patches.filter((_, i) => pullState.selected[i])
    if (chosen.length === 0) return
    setPullState((s) => ({ ...s, applying: true, error: undefined }))
    try {
      const res = await fetch("/api/confluence/pull-smart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          componentId: component.id,
          apply: true,
          patches: chosen,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setPullState((s) => ({
          ...s,
          applying: false,
          error: json.error || `HTTP ${res.status}`,
        }))
      } else {
        setPullState((s) => ({
          ...s,
          applying: false,
          appliedCount: json.appliedCount ?? chosen.length,
        }))
        // Refresh component data
        const fresh = await fetch(`/api/components/${component.id}`).then((r) =>
          r.json()
        )
        setComponent(fresh)
      }
    } catch (e) {
      setPullState((s) => ({
        ...s,
        applying: false,
        error: e instanceof Error ? e.message : "Unknown error",
      }))
    }
  }

  const togglePatch = (index: number) => {
    setPullState((s) => ({
      ...s,
      selected: { ...s.selected, [index]: !s.selected[index] },
    }))
  }

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const handleDelete = async () => {
    if (!component) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/components/${component.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha: component.sha }),
      })
      if (!res.ok) throw new Error("Failed to delete")
      router.push("/")
    } catch {
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  // Download this component as its canonical v2 YAML (re-importable via
  // the catalog Import dialog). Strip the git sha — it is not part of the
  // component model and would only produce an "unknown field" warning on
  // re-import.
  const handleDownloadYaml = () => {
    if (!component) return
    const { sha: _sha, ...rest } = component
    void _sha
    const text = componentToYaml(rest)
    const blob = new Blob([text], { type: "application/x-yaml;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${component.id}.yaml`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (loading || !component) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Loading component...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <TypeIcon type={component.type} className="h-6 w-6" />
            <h1 className="text-3xl font-bold">{component.name}</h1>
            <StatusBadge status={component.status} />
          </div>
          <p className="text-muted-foreground mt-1">
            {component.description.oneliner}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href={`/edit/${component.id}`}>
            <Button variant="outline">
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
          </Link>
          <Button variant="outline" onClick={handleDownloadYaml}>
            <Download className="h-4 w-4 mr-2" />
            Download YAML
          </Button>
          <Button
            variant="outline"
            className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>

      {/* Identity panel — at-a-glance metadata + documentation maturity */}
      {(() => {
        const m = computeMaturity(component)
        return (
          <div className="rounded-lg border bg-gradient-to-r from-slate-50 to-blue-50/40 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <div className="flex items-center gap-1.5">
                <TypeIcon type={component.type} className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-xs uppercase tracking-wider">Type</span>
                <span className="font-medium">{TYPE_LABELS[component.type]}</span>
              </div>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground text-xs uppercase tracking-wider">Status</span>
                <StatusBadge status={component.status} />
              </div>
              {component.owner && (
                <>
                  <div className="h-4 w-px bg-border" />
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground text-xs uppercase tracking-wider">Owner</span>
                    <span className="font-medium">{component.owner}</span>
                  </div>
                </>
              )}
              {component.tags && component.tags.length > 0 && (
                <>
                  <div className="h-4 w-px bg-border" />
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-muted-foreground text-xs uppercase tracking-wider">Tags</span>
                    {component.tags.slice(0, 6).map((t) => (
                      <Badge key={t} variant="secondary" className="text-xs">
                        {t}
                      </Badge>
                    ))}
                    {component.tags.length > 6 && (
                      <span className="text-xs text-muted-foreground">
                        +{component.tags.length - 6}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs uppercase tracking-wider text-muted-foreground shrink-0">
                Documentation maturity
              </span>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden max-w-md">
                <div
                  className={`h-full ${m.bandColor} transition-all`}
                  style={{ width: `${m.percent}%` }}
                />
              </div>
              <span className="text-xs font-semibold whitespace-nowrap">
                {m.percent}%{" "}
                <span className="text-muted-foreground font-normal">
                  ({m.filled}/{m.total} fields · {m.bandLabel})
                </span>
              </span>
              <Tooltip>
                <TooltipTrigger className="cursor-help">
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-xs text-left">
                  <p className="font-semibold mb-1 text-xs">Fields ({m.filled}/{m.total} filled):</p>
                  <ul className="text-xs space-y-0.5">
                    {m.fields.map((f) => (
                      <li key={f.key}>
                        <span className={f.filled ? "text-emerald-600" : "text-red-600"}>
                          {f.filled ? "✓" : "✗"}
                        </span>{" "}
                        {f.label}
                      </li>
                    ))}
                  </ul>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        )
      })()}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="rounded-lg border border-destructive bg-destructive/5 p-4">
          <p className="text-sm font-medium mb-3">
            Are you sure you want to delete <strong>{component.name}</strong>? This action cannot be undone.
          </p>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Yes, delete"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteConfirm(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Tab nav — tabs whose blocks are all hidden in config are dropped */}
      <div className="border-b">
        <nav className="-mb-px flex gap-1 flex-wrap" role="tablist">
          {(
            [
              { id: "overview", label: "Overview" },
              { id: "properties", label: "Properties" },
              { id: "rules", label: "Rules & Calculations" },
              { id: "blast-radius", label: "Blast Radius" },
              { id: "documentation", label: "Documentation" },
              { id: "diagrams", label: "Diagrams" },
              { id: "history", label: "History" },
            ] as { id: DetailTab; label: string }[]
          )
            .filter((t) => isTabVisible(uiBlocks, t.id as DetailTabId))
            .map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-gray-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* OVERVIEW TAB */}
      {tab === "overview" && isBlockVisible(uiBlocks, "overview", "heroContext") && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  Component context
                  <Tooltip>
                    <TooltipTrigger className="cursor-help">
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs text-left">
                      Auto-rendered hero diagram combining inputs, outputs, owned data and direct relationships. The picture you should see first.
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowHeroDiagram((v) => !v)}
                >
                  {showHeroDiagram ? (
                    <EyeOff className="h-4 w-4 mr-1" />
                  ) : (
                    <Eye className="h-4 w-4 mr-1" />
                  )}
                  {showHeroDiagram ? "Hide" : "Show"}
                </Button>
              </div>
            </CardHeader>
            {showHeroDiagram && (
              <CardContent>
                <MermaidPreview
                  chart={buildHeroContextMermaid(
                    component,
                    nameLookup,
                    combinedLinks
                  )}
                />
              </CardContent>
            )}
          </Card>
        </>
      )}

      {/* Data model registry — only rendered when the component is a
          table and the YAML carries a registry link. The card hides
          itself when the registry integration is not configured. */}
      {tab === "overview" &&
        component.type === "table" &&
        component.data_model?.entity && (
          <DataModelEntityCard entityName={component.data_model.entity} />
        )}

      {/* RULES & CALCULATIONS TAB */}
      {tab === "rules" && isBlockVisible(uiBlocks, "rules", "section") && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <CardTitle className="flex items-center gap-2 text-base">
                  Rules &amp; Calculations
                  <Tooltip>
                    <TooltipTrigger className="cursor-help">
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-sm text-left">
                      <p className="font-semibold mb-1">Business logic this component implements:</p>
                      <ul className="text-xs space-y-0.5">
                        <li><strong>Formula</strong> — a calculation or expression</li>
                        <li><strong>Rule</strong> — Given / When / Then behavior</li>
                        <li><strong>Constraint</strong> — invariant that must always hold</li>
                      </ul>
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Calculations, behavioral rules and invariants. Owners can capture
                  the &quot;what does this component actually do&quot; logic without
                  digging into source code.
                </p>
              </div>
              <div className="flex items-center gap-1">
                <BlockEditDialog
                  componentId={component.id}
                  block="rules"
                  onSaved={refreshComponent}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRulesImportOpen(true)}
                  title="AI scans a PDF or Confluence page for rules relevant to this component"
                >
                  <Sparkles className="h-4 w-4 mr-1" />
                  Import from documents
                </Button>
                {sourceConfigured && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSourceScanOpen(true)}
                    title="Let AI find which source files implement this component"
                  >
                    <Radar className="h-4 w-4 mr-1" />
                    Find source files
                  </Button>
                )}
                {component.source?.paths && component.source.paths.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCodeAuditOpen(true)}
                    title="Read the mapped source code and fill each rule's implemented facet"
                  >
                    <FileCode2 className="h-4 w-4 mr-1" />
                    Check against code
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {(!component.rules || component.rules.length === 0) ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                No rules defined.{" "}
                <BlockEditDialog
                  componentId={component.id}
                  block="rules"
                  onSaved={refreshComponent}
                  trigger={
                    <button className="text-blue-700 hover:underline" type="button">
                      Add the first rule
                    </button>
                  }
                />
                .
              </div>
            ) : (
              <div className="space-y-3">
                {component.rules.map((rule, i) => (
                  <div
                    key={i}
                    className={`rounded-md border p-4 ${
                      rule.kind === "constraint"
                        ? "border-red-200 bg-red-50/40"
                        : rule.kind === "rule"
                        ? "border-emerald-200 bg-emerald-50/30"
                        : "border-blue-200 bg-blue-50/30"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Badge
                        variant="outline"
                        className={`text-[10px] uppercase tracking-wider ${
                          RULE_KIND_COLORS[rule.kind] || ""
                        }`}
                      >
                        {RULE_KIND_LABELS[rule.kind] || rule.kind}
                      </Badge>
                      <h3 className="font-semibold text-sm">{rule.name}</h3>
                    </div>
                    {rule.summary && (
                      <p className="text-sm text-foreground/80 mb-3">
                        {rule.summary}
                      </p>
                    )}

                    {rule.kind === "formula" && rule.formula && (
                      <pre className="bg-white border rounded-md p-3 text-xs font-mono overflow-x-auto">
                        {rule.formula}
                      </pre>
                    )}

                    {rule.kind === "rule" && (rule.given || rule.when || rule.then) && (
                      <div className="space-y-1.5 bg-white border rounded-md p-3 text-sm">
                        {rule.given && (
                          <div className="flex gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 w-12 pt-0.5 shrink-0">
                              Given
                            </span>
                            <span className="text-foreground/90">{rule.given}</span>
                          </div>
                        )}
                        {rule.when && (
                          <div className="flex gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 w-12 pt-0.5 shrink-0">
                              When
                            </span>
                            <span className="text-foreground/90">{rule.when}</span>
                          </div>
                        )}
                        {rule.then && (
                          <div className="flex gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 w-12 pt-0.5 shrink-0">
                              Then
                            </span>
                            <span className="text-foreground/90">{rule.then}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {rule.kind === "constraint" && rule.enforced_in && rule.enforced_in.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-2 flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-red-700">
                          Enforced in
                        </span>
                        {rule.enforced_in.map((id) => (
                          <Link
                            key={id}
                            href={`/component/${id}`}
                            className="font-mono text-blue-700 hover:underline"
                          >
                            {id}
                          </Link>
                        ))}
                      </div>
                    )}

                    {rule.description && (
                      <p className="text-xs text-muted-foreground mt-3 whitespace-pre-line">
                        {rule.description}
                      </p>
                    )}

                    {(rule.requested || rule.implemented) && (
                      <ProvenancePanel
                        reconciliation={rule.reconciliation}
                        requested={
                          rule.requested
                            ? { rows: ruleFacetRows(rule.requested), source: rule.requested.source }
                            : undefined
                        }
                        implemented={
                          rule.implemented
                            ? { rows: ruleFacetRows(rule.implemented), evidence: rule.implemented.evidence }
                            : undefined
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* BLAST RADIUS TAB */}
      {tab === "blast-radius" && isBlockVisible(uiBlocks, "blastRadius", "section") && (
        <Card>
          <CardContent className="pt-6">
            <BlastRadiusView componentId={component.id} active={tab === "blast-radius"} />
          </CardContent>
        </Card>
      )}

      {/* DOCUMENTATION TAB */}
      {tab === "documentation" && isBlockVisible(uiBlocks, "documentation", "section") && (
        <div className="space-y-6">
          {/* Generate */}
          <Card className="border-blue-200 bg-blue-50/30">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-5 w-5 text-blue-600" />
                Generate Documentation
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                AI-generated docs for this component. Pick an audience or document type, click Generate, then publish or export.
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={genDocType}
                  onValueChange={(v) =>
                    setGenDocType(
                      v as "audience" | "detailed-solution" | "audit-report" | "security-report"
                    )
                  }
                >
                  <SelectTrigger className="h-9 w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="audience">By audience</SelectItem>
                    <SelectItem value="detailed-solution">Detailed Solution Description</SelectItem>
                    <SelectItem value="audit-report">Audit Report</SelectItem>
                    <SelectItem value="security-report">Security Report</SelectItem>
                  </SelectContent>
                </Select>
                {genDocType === "audience" && (
                  <Select
                    value={genAudience}
                    onValueChange={(v) =>
                      setGenAudience(v as "Technical" | "Business" | "Executive")
                    }
                  >
                    <SelectTrigger className="h-9 w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Technical">Technical</SelectItem>
                      <SelectItem value="Business">Business</SelectItem>
                      <SelectItem value="Executive">Executive</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Button
                  onClick={generateDocs}
                  disabled={generating}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {generating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Generate
                    </>
                  )}
                </Button>
                {generated && !showDocModal && (
                  <Button variant="outline" onClick={() => setShowDocModal(true)}>
                    <FileText className="h-4 w-4 mr-2" />
                    Re-open last result
                  </Button>
                )}
                {genError && (
                  <span className="text-xs text-destructive">{genError}</span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Confluence sync */}
          {confluence?.configured && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Send className="h-5 w-5 text-blue-600" />
                  Confluence
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {confluence.published ? (
                    <>
                      Published. Last sync:{" "}
                      <strong>
                        {confluence.lastSyncedAt
                          ? new Date(confluence.lastSyncedAt).toLocaleString("en-GB", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </strong>
                      .
                    </>
                  ) : (
                    <>Not yet published. Publish to make it visible to your team in Confluence.</>
                  )}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={publishToConfluenceStandalone}
                    disabled={publishingStandalone}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {publishingStandalone ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {generated ? "Publishing..." : "Generating + publishing..."}
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4 mr-2" />
                        {confluence.published ? "Re-publish to Confluence" : "Publish to Confluence"}
                      </>
                    )}
                  </Button>
                  {confluence.published && confluence.pageUrl && (
                    <a href={confluence.pageUrl} target="_blank" rel="noreferrer">
                      <Button
                        variant="outline"
                        className="border-blue-300 text-blue-700 hover:bg-blue-50"
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Open in Confluence
                      </Button>
                    </a>
                  )}
                  {confluence.published && (
                    <Button
                      variant="outline"
                      className="border-blue-300 text-blue-700 hover:bg-blue-50"
                      onClick={fetchPullDiff}
                      disabled={pullState.loading}
                    >
                      {pullState.loading ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      Pull from Confluence
                    </Button>
                  )}
                </div>
                {publishStandaloneStatus && (
                  <div
                    className={`text-sm rounded-md p-3 border ${
                      publishStandaloneStatus.ok
                        ? "bg-green-50 border-green-200 text-green-900"
                        : "bg-red-50 border-red-200 text-red-900"
                    }`}
                  >
                    {publishStandaloneStatus.ok ? (
                      <>
                        Published to Confluence ({publishStandaloneStatus.action}) under capability{" "}
                        <strong>{publishStandaloneStatus.capabilityParent}</strong>.{" "}
                        <a
                          href={publishStandaloneStatus.pageUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="underline font-medium"
                        >
                          Open page
                        </a>
                        {publishStandaloneStatus.warning && (
                          <div className="mt-1 text-xs text-amber-700">
                            Note: {publishStandaloneStatus.warning}
                          </div>
                        )}
                      </>
                    ) : (
                      <>Publish failed: {publishStandaloneStatus.error}</>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Export & Copy */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Download className="h-5 w-5 text-muted-foreground" />
                Export &amp; Copy
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Take this component out of arch-tool — into Draw.io, Slack, an email, anywhere.
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <DrawioLibraryDialog label="Draw.io library" />
                <Button
                  variant="outline"
                  onClick={() => copyToClipboard(component.id, "id")}
                >
                  {copiedField === "id" ? (
                    <Check className="h-4 w-4 mr-2" />
                  ) : (
                    <Copy className="h-4 w-4 mr-2" />
                  )}
                  Copy ID
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    copyToClipboard(
                      component.description?.description ||
                        component.description?.technical ||
                        component.description?.business ||
                        "",
                      "description"
                    )
                  }
                >
                  {copiedField === "description" ? (
                    <Check className="h-4 w-4 mr-2" />
                  ) : (
                    <Copy className="h-4 w-4 mr-2" />
                  )}
                  Copy Description
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Info */}
        {tab === "overview" && isBlockVisible(uiBlocks, "overview", "details") && (
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">ID</span>
                <p className="font-mono">{component.id}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Type</span>
                <p>{TYPE_LABELS[component.type]}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Owner</span>
                <p>{component.owner}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Status</span>
                {/* StatusBadge renders a Badge which is a <div>; was
                    previously wrapped in <p>, which is illegal HTML and
                    threw a hydration mismatch in dev. Use a block div
                    with a top margin to keep the visual rhythm. */}
                <div className="mt-1">
                  <StatusBadge status={component.status} />
                </div>
              </div>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">Tags</span>
              <div className="flex gap-1 flex-wrap mt-1">
                {component.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
        )}

        {/* Description — unified field with backward-compat fallback to
            the legacy technical / business pair so components that have
            not been re-saved since the v0.6 migration still render. */}
        {tab === "overview" && isBlockVisible(uiBlocks, "overview", "descriptions") && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Description</CardTitle>
              <BlockEditDialog
                componentId={component.id}
                block="description"
                onSaved={refreshComponent}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {component.description?.oneliner && (
              <div>
                <span className="text-sm text-muted-foreground font-medium">
                  One-liner
                </span>
                <p className="text-sm mt-1">{component.description.oneliner}</p>
              </div>
            )}
            {component.description?.description ? (
              <div>
                <p className="text-sm whitespace-pre-wrap">
                  {component.description.description}
                </p>
              </div>
            ) : (
              <>
                {component.description?.technical && (
                  <div>
                    <span className="text-sm text-muted-foreground font-medium">
                      Technical
                    </span>
                    <p className="text-sm mt-1 whitespace-pre-wrap">
                      {component.description.technical}
                    </p>
                  </div>
                )}
                {component.description?.business && (
                  <div>
                    <span className="text-sm text-muted-foreground font-medium">
                      Business
                    </span>
                    <p className="text-sm mt-1 whitespace-pre-wrap">
                      {component.description.business}
                    </p>
                  </div>
                )}
              </>
            )}
            {!component.description?.oneliner &&
              !component.description?.description &&
              !component.description?.technical &&
              !component.description?.business && (
                <p className="text-sm text-muted-foreground italic">
                  No description yet.
                </p>
              )}
          </CardContent>
        </Card>
        )}

        {/* v2: Interfaces + Relationships unified into the Links card
            below. Inbound versions of both are merged into that same
            card with their inverse role labels (calls ↔ serves,
            part-of ↔ contains), so the analyst sees one list. */}

        {/* Links — v2 unified edges card */}
        {tab === "properties" && isBlockVisible(uiBlocks, "technical", "relationships") && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                Links
                <Tooltip>
                  <TooltipTrigger className="cursor-help">
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-sm text-left">
                    <p className="font-semibold mb-1">Every edge to another component:</p>
                    <ul className="text-xs space-y-0.5">
                      <li><strong>Calls</strong> — this actively calls / consumes from target</li>
                      <li><strong>Serves</strong> — this exposes / provides to target</li>
                      <li><strong>Part of</strong> — this is contained in target</li>
                      <li><strong>Contains</strong> — this contains target</li>
                      <li><strong>Reads from</strong> — this reads data from target</li>
                      <li><strong>Writes to</strong> — this writes data to target</li>
                    </ul>
                    <p className="text-xs mt-1 text-muted-foreground">
                      Inbound rows (declared on other components) are
                      merged in with their inverse label.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
              <div className="flex items-center gap-1">
                <BlockEditDialog
                  componentId={component.id}
                  block="links"
                  onSaved={refreshComponent}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowRelationshipsViz((v) => !v)}
                  disabled={combinedLinks.length === 0}
                  title="Visualize links as a graph"
                >
                  {showRelationshipsViz ? (
                    <EyeOff className="h-4 w-4 mr-1" />
                  ) : (
                    <Eye className="h-4 w-4 mr-1" />
                  )}
                  Visualize
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {combinedLinks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No links defined.
              </p>
            ) : (
              <div className="space-y-2">
                {combinedLinks.map((rel, i) => {
                  // Resolve target against the catalog snapshot.
                  const targetComp = allComponents.find((c) => c.id === rel.target)
                  const body = (
                    <>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      <Badge
                        variant="outline"
                        className={`text-xs shrink-0 ${LINK_ROLE_COLORS[rel.role] || ""}`}
                      >
                        {rel.displayLabel}
                      </Badge>
                      {targetComp ? (
                        <span className="inline-flex items-center gap-1.5">
                          <TypeIcon
                            type={targetComp.type as never}
                            className="h-3.5 w-3.5 text-muted-foreground"
                          />
                          <span className="font-medium">{targetComp.name}</span>
                        </span>
                      ) : !allComponentsLoaded ? (
                        // Catalog snapshot still loading — show the
                        // raw id without the "missing" badge so the
                        // analyst doesn't flash a false alarm.
                        <span className="font-medium">{rel.target || "(unset)"}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="font-mono">{rel.target || "(unset)"}</span>
                          <Badge
                            variant="outline"
                            className="text-[10px] uppercase border-red-300 bg-red-50 text-red-700"
                          >
                            missing
                          </Badge>
                        </span>
                      )}
                      {rel.protocol && (
                        <Badge variant="secondary" className="text-xs">
                          {rel.protocol}
                        </Badge>
                      )}
                      {rel.name && (
                        <span className="text-xs font-medium truncate">
                          {rel.name}
                        </span>
                      )}
                      {rel.description && (
                        <span className="text-muted-foreground text-xs truncate">
                          {rel.description}
                        </span>
                      )}
                    </>
                  )
                  const titleAttr = rel.isInverse
                    ? `Declared on ${rel.declaredOn ?? "the other component"} — edit it there to change this row.`
                    : undefined
                  return targetComp ? (
                    <Link
                      key={`${rel.target}-${i}`}
                      href={`/component/${rel.target}`}
                      className="flex items-center gap-3 text-sm p-2 rounded-md hover:bg-muted transition-colors"
                      title={titleAttr}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div
                      key={`${rel.target}-${i}`}
                      className="flex items-center gap-3 text-sm p-2 rounded-md bg-red-50/30"
                      title={titleAttr ?? "Target component is not in the catalog"}
                    >
                      {body}
                    </div>
                  )
                })}
              </div>
            )}
            {showRelationshipsViz && combinedLinks.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <MermaidPreview
                  chart={buildRelationshipsMermaid(
                    component,
                    nameLookup,
                    combinedLinks
                  )}
                />
              </div>
            )}
          </CardContent>
        </Card>
        )}

        {/* Inbound relationships are no longer a separate card — they
            are merged into the Relationships card above with their
            inverse labels (see INVERSE_RELATIONSHIP_LABELS), so
            "Parent of X" shows up on the parent's page whether the
            parent declared `parent-of: X` or X declared `child-of:
            parent`. */}

        {/* Capabilities — rendered whenever the Settings flag is on,
            even with no data yet, so the analyst can use the per-block
            Edit dialog to add the first row. */}
        {tab === "properties" && isBlockVisible(uiBlocks, "business", "capabilities") && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  Capabilities
                  <Tooltip>
                    <TooltipTrigger className="cursor-help">
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs text-left">
                      <p className="font-semibold mb-1">Role this component plays in each capability:</p>
                      <ul className="text-xs space-y-0.5">
                        <li><strong>Owner</strong> — implements the capability</li>
                        <li><strong>Contributor</strong> — assists (logs, metrics)</li>
                        <li><strong>Consumer</strong> — uses the capability</li>
                        <li><strong>Indirect</strong> — touches it incidentally</li>
                      </ul>
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
                <div className="flex items-center gap-1">
                  <BlockEditDialog
                    componentId={component.id}
                    block="capabilities"
                    onSaved={refreshComponent}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowCapabilitiesViz((v) => !v)}
                    title="Visualize capabilities as a graph"
                  >
                    {showCapabilitiesViz ? (
                      <EyeOff className="h-4 w-4 mr-1" />
                    ) : (
                      <Eye className="h-4 w-4 mr-1" />
                    )}
                    Visualize
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {(!component.capabilities || component.capabilities.length === 0) ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No capabilities yet — use{" "}
                  <span className="font-medium">Edit</span> to add the first row.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left font-medium pb-2">Capability</th>
                      <th className="text-left font-medium pb-2 w-32">Role</th>
                      <th className="text-left font-medium pb-2">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {component.capabilities.map((cap, i) => (
                      <tr key={i} className="border-t">
                        <td className="py-2 font-medium">{cap.name}</td>
                        <td className="py-2">
                          <Badge
                            variant="outline"
                            className={`text-xs ${CAPABILITY_ROLE_COLORS[cap.role] || ""}`}
                          >
                            {CAPABILITY_ROLE_LABELS[cap.role] || cap.role}
                          </Badge>
                        </td>
                        <td className="py-2 text-muted-foreground">
                          {cap.description || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {showCapabilitiesViz && component.capabilities && component.capabilities.length > 0 && (
                <div className="mt-4 border-t pt-3">
                  <MermaidPreview chart={buildCapabilitiesMermaid(component)} />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Non-Functional Requirements — rendered whenever the
            Settings flag is on so the empty state can hand off to the
            Edit dialog. */}
        {tab === "properties" && isBlockVisible(uiBlocks, "technical", "nfr") && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Non-Functional Requirements</CardTitle>
                <BlockEditDialog
                  componentId={component.id}
                  block="nfr"
                  onSaved={refreshComponent}
                />
              </div>
            </CardHeader>
            <CardContent>
              {(!component.nfr || !Object.values(component.nfr).some(Boolean)) ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No NFRs set — use{" "}
                  <span className="font-medium">Edit</span> to fill in availability,
                  RTO/RPO, latency, throughput, classification or scaling.
                </p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  {component.nfr.availability && (
                    <div>
                      <span className="text-muted-foreground">Availability</span>
                      <p className="font-medium">{component.nfr.availability}</p>
                    </div>
                  )}
                  {component.nfr.rto && (
                    <div>
                      <span className="text-muted-foreground">RTO</span>
                      <p className="font-medium">{component.nfr.rto}</p>
                    </div>
                  )}
                  {component.nfr.rpo && (
                    <div>
                      <span className="text-muted-foreground">RPO</span>
                      <p className="font-medium">{component.nfr.rpo}</p>
                    </div>
                  )}
                  {component.nfr.max_latency && (
                    <div>
                      <span className="text-muted-foreground">Max Latency</span>
                      <p className="font-medium">{component.nfr.max_latency}</p>
                    </div>
                  )}
                  {component.nfr.throughput && (
                    <div>
                      <span className="text-muted-foreground">Throughput</span>
                      <p className="font-medium">{component.nfr.throughput}</p>
                    </div>
                  )}
                  {component.nfr.data_classification && (
                    <div>
                      <span className="text-muted-foreground">Data Classification</span>
                      <p className="font-medium">{DATA_CLASSIFICATION_LABELS[component.nfr.data_classification]}</p>
                    </div>
                  )}
                  {component.nfr.scaling && (
                    <div>
                      <span className="text-muted-foreground">Scaling</span>
                      <p className="font-medium capitalize">{component.nfr.scaling}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Risks — rendered whenever the Settings flag is on so the
            empty state can hand off to the Edit dialog. */}
        {tab === "overview" && isBlockVisible(uiBlocks, "overview", "risks") && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Risks</CardTitle>
                <BlockEditDialog
                  componentId={component.id}
                  block="risks"
                  onSaved={refreshComponent}
                />
              </div>
            </CardHeader>
            <CardContent>
              {(!component.risks || component.risks.length === 0) ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No risks listed — use{" "}
                  <span className="font-medium">Edit</span> to add the first one.
                </p>
              ) : (
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {component.risks.map((risk, i) => (
                    <li key={i}>{risk}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Diagrams this component appears in */}
      {tab === "diagrams" && isBlockVisible(uiBlocks, "diagrams", "section") && (
      <Card className="mt-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <FileImage className="h-4 w-4" />
            Diagrams referencing this component
          </CardTitle>
        </CardHeader>
        <CardContent>
          {diagramRefs === null ? (
            <p className="text-xs text-muted-foreground">Scanning...</p>
          ) : diagramRefs.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No diagrams reference this component yet.{" "}
              <Link
                href="/diagrams"
                className="underline text-blue-700 hover:no-underline"
              >
                Open the diagram builder
              </Link>{" "}
              to add it.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {diagramRefs.map((d) => (
                <Link
                  key={d.name}
                  href={`/diagrams?preview=${encodeURIComponent(d.name)}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border bg-white hover:bg-blue-50 hover:border-blue-300 text-sm transition-colors"
                >
                  <FileImage className="h-3.5 w-3.5 text-blue-600" />
                  {d.name}
                  <Eye className="h-3 w-3 text-muted-foreground" />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Change History */}
      {tab === "history" && isBlockVisible(uiBlocks, "history", "section") && (
      <Card className="mt-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <History className="h-4 w-4" />
            Change History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <p className="text-xs text-muted-foreground">Loading history...</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-muted-foreground">No history available.</p>
          ) : (
            <div className="space-y-1.5">
              {history.map((commit) => (
                <div
                  key={commit.sha}
                  className="flex items-baseline gap-3 text-xs text-muted-foreground"
                >
                  <span className="font-mono shrink-0">{commit.sha}</span>
                  <span className="shrink-0">
                    {commit.date
                      ? new Date(commit.date).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : ""}
                  </span>
                  <span className="truncate text-foreground/70">
                    {commit.message.split("\n")[0]}
                  </span>
                  <span className="shrink-0 ml-auto">{commit.author}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Generated documentation viewer */}
      <Dialog open={showDocModal} onOpenChange={setShowDocModal}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 [&>button:last-child]:hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b shrink-0 bg-gray-50">
            <DialogHeader className="flex-1">
              <DialogTitle className="flex items-center gap-3">
                <FileText className="h-5 w-5" />
                <span>{component.name}</span>
                <span className="inline-flex items-center px-3 py-1 rounded text-xs font-semibold bg-gray-900 text-white uppercase tracking-wide">
                  {genDocType === "audience"
                    ? genAudience
                    : genDocType === "detailed-solution"
                    ? "Detailed Solution"
                    : genDocType === "audit-report"
                    ? "Audit Report"
                    : "Security Report"}
                </span>
              </DialogTitle>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={copyDocMarkdown}>
                {docCopied ? (
                  <Check className="h-4 w-4 mr-1" />
                ) : (
                  <Copy className="h-4 w-4 mr-1" />
                )}
                {docCopied ? "Copied" : "Copy Markdown"}
              </Button>
              {confluence?.configured && (
                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={publishGeneratedToConfluence}
                  title="Publish this generated documentation to Confluence"
                >
                  <Send className="h-4 w-4 mr-1" />
                  Publish to Confluence
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDocModal(false)}
              >
                <X className="h-4 w-4 mr-1" />
                Close
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-8 py-6 bg-white">
            <div
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
                      return (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      )
                    }
                    return (
                      <pre className="bg-gray-100 p-4 rounded-md overflow-x-auto my-3">
                        <code className={className} {...props}>
                          {children}
                        </code>
                      </pre>
                    )
                  },
                  pre({ children }) {
                    return <>{children}</>
                  },
                }}
              >
                {generated || ""}
              </ReactMarkdown>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pullState.showDialog}
        onOpenChange={(v) =>
          setPullState((s) => ({
            ...s,
            showDialog: v,
            ...(v
              ? {}
              : {
                  patches: undefined,
                  error: undefined,
                  appliedCount: undefined,
                  selected: {},
                }),
          }))
        }
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-blue-600" />
              Pull from Confluence — {component.name}
            </DialogTitle>
            <DialogDescription>
              Smart scan combines the deterministic Properties table with an AI
              read of the whole page. Tick the changes you want to apply — each
              applied change is committed to the GitHub repo.
            </DialogDescription>
          </DialogHeader>

          {pullState.loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading Confluence page and running AI scan...
            </div>
          )}

          {pullState.error && (
            <div className="bg-destructive/10 text-destructive text-sm rounded-md p-3">
              {pullState.error}
            </div>
          )}

          {!pullState.loading && pullState.patches !== undefined && !pullState.error && (
            <div className="space-y-4">
              {pullState.appliedCount !== undefined ? (
                <div className="bg-green-50 border border-green-200 text-green-900 text-sm rounded-md p-3">
                  Applied {pullState.appliedCount} change
                  {pullState.appliedCount === 1 ? "" : "s"} to the catalog.
                  New commit pushed to GitHub.
                </div>
              ) : pullState.patches.length === 0 ? (
                <div className="bg-muted/40 text-sm rounded-md p-4 text-center">
                  No differences detected. Catalog and Confluence agree.
                </div>
              ) : (
                <>
                  <div className="text-sm flex items-center justify-between">
                    <span>
                      <strong>{pullState.patches.length}</strong> proposed
                      change{pullState.patches.length === 1 ? "" : "s"} from
                      AI scan. Low-confidence proposals are unticked by default.
                    </span>
                    {pullState.confluenceUrl && (
                      <a
                        href={pullState.confluenceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline text-blue-700 inline-flex items-center gap-1"
                      >
                        Open page
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <div className="space-y-2">
                    {pullState.patches.map((p, i) => {
                      const checked = !!pullState.selected[i]
                      const confColor =
                        p.confidence === "high"
                          ? "bg-green-100 text-green-800 border-green-300"
                          : p.confidence === "medium"
                          ? "bg-yellow-100 text-yellow-800 border-yellow-300"
                          : "bg-gray-100 text-gray-700 border-gray-300"
                      return (
                        <label
                          key={i}
                          className={`flex items-start gap-3 border rounded-md p-3 cursor-pointer transition-colors ${
                            checked ? "bg-blue-50/50 border-blue-200" : "bg-white"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePatch(i)}
                            className="mt-1"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="font-mono text-xs font-semibold">
                                {p.field}
                              </span>
                              <Badge
                                variant="outline"
                                className={`text-[10px] uppercase ${confColor}`}
                              >
                                {p.confidence} confidence
                              </Badge>
                            </div>
                            <div className="text-xs space-y-0.5">
                              <div className="text-muted-foreground">
                                <span className="font-medium text-gray-500">Current:</span>{" "}
                                <span className="line-through">
                                  {p.oldValue || "(empty)"}
                                </span>
                              </div>
                              <div className="text-blue-900">
                                <span className="font-medium text-blue-700">New:</span>{" "}
                                <span className="font-medium">
                                  {p.newValue || "(empty)"}
                                </span>
                              </div>
                              {p.evidence && (
                                <div className="text-muted-foreground italic mt-1">
                                  &ldquo;{p.evidence}&rdquo;
                                </div>
                              )}
                            </div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                  <div className="flex items-center justify-end gap-2 border-t pt-3">
                    <Button
                      onClick={applyPull}
                      disabled={
                        pullState.applying ||
                        Object.values(pullState.selected).every((v) => !v)
                      }
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {pullState.applying ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Applying...
                        </>
                      ) : (
                        <>
                          Apply selected ({Object.values(pullState.selected).filter(Boolean).length}) &amp; commit
                        </>
                      )}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <RulesImportDialog
        open={rulesImportOpen}
        onOpenChange={setRulesImportOpen}
        componentId={component.id}
        componentName={component.name}
        existingRules={component.rules || []}
        onImport={async (newRules: ComponentRule[]): Promise<string | void> => {
          const merged: ComponentRule[] = [...(component.rules || []), ...newRules]
          const { sha, ...rest } = component
          const updated = { ...rest, rules: merged }
          const res = await fetch(`/api/components/${component.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...updated, sha }),
          })
          if (!res.ok) {
            const body = await res.json().catch(() => ({ error: "Unknown error" }))
            return body.error || `Save failed (${res.status})`
          }
          // Refresh component to pick up the new sha + canonical state.
          const fresh = await fetch(`/api/components/${component.id}`).then((r) => r.json())
          setComponent(fresh)
        }}
      />

      <CodeRuleAuditDialog
        open={codeAuditOpen}
        onOpenChange={setCodeAuditOpen}
        componentId={component.id}
        rules={component.rules || []}
        onApplied={refreshComponent}
      />

      <SourceScanDialog
        open={sourceScanOpen}
        onOpenChange={setSourceScanOpen}
        componentId={component.id}
        existingPaths={component.source?.paths || []}
        onApplied={refreshComponent}
      />
    </div>
  )
}
