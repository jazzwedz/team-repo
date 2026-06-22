"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  COMPONENT_TYPES,
  COMPONENT_STATUSES,
  TYPE_LABELS,
  LINK_ROLES,
  LINK_ROLE_LABELS,
  LINK_PROTOCOLS,
  BUSINESS_CAPABILITIES,
  DATA_CLASSIFICATIONS,
  DATA_CLASSIFICATION_LABELS,
  SCALING_MODELS,
  CAPABILITY_ROLES,
  CAPABILITY_ROLE_LABELS,
  RULE_KINDS,
  RULE_KIND_LABELS,
  RULE_KIND_HINTS,
} from "@/lib/constants"
import type {
  Component,
  ComponentLink,
  ComponentNFR,
  ComponentCapability,
  CapabilityRole,
  ComponentType,
  ComponentProcess,
  ComponentRule,
  RuleKind,
} from "@/lib/types"
import { Plus, Trash2, Info, ChevronUp, ChevronDown, AlertTriangle, ArrowDownAZ, Eye, EyeOff } from "lucide-react"
import { MermaidPreview } from "@/components/mermaid-preview"
import { buildRelationshipsMermaid } from "@/lib/component-mermaid"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { useUIConfig } from "@/components/UIConfigProvider"
import { isBlockVisible } from "@/lib/ui-blocks"
import { DataModelLinkCard } from "@/components/DataModelLinkCard"
import { SourceCodeCard } from "@/components/SourceCodeCard"
import { ComponentTargetPicker } from "@/components/ComponentTargetPicker"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"

interface ComponentFormProps {
  initialData?: Component & { sha?: string }
  isEdit?: boolean
  // When true, the form renders as a passive viewer — Save is hidden
  // and the underlying <fieldset> blocks every input from accepting
  // keystrokes. Used by the edit page when the active component is
  // currently being edited by another user (lock denied).
  readOnly?: boolean
  // Lets the parent page render Cancel + Save buttons in the page
  // header instead of at the bottom of the (very long) form. The form
  // tags its <form> element with `id={formId}` so the parent can
  // submit via a `<button type="submit" form={formId}>` placed
  // anywhere in the React tree.
  formId?: string
  // Callback mirror of the internal saving flag — parent uses this to
  // disable the header Save button while a save is in flight.
  onSavingChange?: (saving: boolean) => void
  /**
   * When set, the form renders ONLY the matching block (e.g. just the
   * Links card or just the NFR card). The Basic Information card and
   * every other section is hidden, but every field's value is still
   * kept in `form` state from `initialData` so save constructs a
   * full Component object. Used by `BlockEditDialog` to give the
   * analyst a focused edit modal on each detail-page card.
   */
  focusBlock?: BlockKey
  /**
   * Optional override for the post-save action. When provided, called
   * instead of the default `router.push(`/component/<id>`)`. Used by
   * BlockEditDialog to close the modal and trigger a parent refetch
   * without navigating away from the detail page.
   */
  onSaveSuccess?: () => void
}

export type BlockKey =
  | "description"
  | "links"
  | "capabilities"
  | "processes"
  | "rules"
  | "nfr"
  | "risks"

// v2 — single edge primitive replacing emptyInterface + emptyRelationship.
// Default role is the most common one (calls); the analyst flips it
// through the role select in the row.
const emptyLink: ComponentLink = {
  target: "",
  role: "calls",
}

const emptyCapability: ComponentCapability = {
  name: "",
  role: "indirect",
  description: "",
}

const emptyRule: ComponentRule = {
  name: "",
  kind: "formula",
  summary: "",
}

// Convert a free-form name into a YAML-safe component id.
// Lowercases, replaces whitespace with dashes, strips anything that is
// not a letter / digit / dash / underscore, and collapses runs of
// dashes. Returns "" when the input has no usable characters; the
// caller falls back to a timestamp-based id in that case.
export function slugifyForId(name: string): string {
  return (name || "")
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/[\s/\\]+/g, "-")
    .replace(/[^a-z0-9_\-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
}

export function ComponentForm({
  initialData,
  isEdit,
  readOnly = false,
  formId,
  onSavingChange,
  focusBlock,
  onSaveSuccess,
}: ComponentFormProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  // Mirror the internal saving flag back up to the parent so a header
  // Save button (rendered outside this form) can disable itself while
  // a save is in flight.
  useEffect(() => {
    onSavingChange?.(saving)
  }, [saving, onSavingChange])
  const [conflictOpen, setConflictOpen] = useState(false)
  const [conflictMessage, setConflictMessage] = useState<string>("")

  // Hide form sections whose detail-page block is hidden by the
  // team-wide config in Settings. The mapping mirrors BLOCK_METAS so
  // the analyst is not asked to edit fields they have chosen not to
  // display anywhere. Basic Information is always visible — the Name
  // input is the only required field on the form.
  const { blocks: uiBlocks } = useUIConfig()
  // When focusBlock is set, only that one card is visible; every
  // other flag flips to false even when Settings would allow it.
  const visible = (block: BlockKey): boolean =>
    focusBlock === undefined || focusBlock === block
  const showBasicInfo = focusBlock === undefined
  const showDescription =
    visible("description") && isBlockVisible(uiBlocks, "overview", "descriptions")
  const showRisks = visible("risks") && isBlockVisible(uiBlocks, "overview", "risks")
  // v2: single Links card replaces the legacy Interfaces +
  // Relationships pair. The `relationships` config key keeps its
  // name so existing config.yaml entries continue to work; the UI
  // label is now "Links".
  const showLinks =
    visible("links") && isBlockVisible(uiBlocks, "technical", "relationships")
  const showNfr = visible("nfr") && isBlockVisible(uiBlocks, "technical", "nfr")
  const showCapabilities =
    visible("capabilities") && isBlockVisible(uiBlocks, "business", "capabilities")
  const showRules = visible("rules") && isBlockVisible(uiBlocks, "rules", "section")
  const tabbed = focusBlock === undefined
  const [formTab, setFormTab] = useState<"overview" | "properties" | "rules">("overview")

  // Fresh catalog snapshot, fetched once per form mount. Used by both
  // the relationship Target Component picker and the interface target
  // typeahead — passed down as a prop so a single fetch feeds every
  // picker in the form, and so the list cannot go stale across
  // navigations (no module-level cache).
  const [existingComponents, setExistingComponents] = useState<
    { id: string; name: string; type: ComponentType }[]
  >([])

  const [form, setForm] = useState<Component>({
    id: "",
    name: "",
    type: "component",
    status: "draft",
    owner: "",
    tags: [],
    description: { oneliner: "", description: "" },
    // v2 — single edge primitive. Migration in github.ts collapses
    // legacy interfaces[] + relationships[] into this on read; the
    // form authors only this shape.
    links: [],
    risks: [],
    capabilities: [],
    data: undefined,
    processes: [],
    rules: [],
    nfr: {},
    schema_version: 2,
    ...(initialData || {}),
  })

  // Tabs — only on the full New/Edit form (focusBlock undefined). They
  // mirror the component VIEW page's tabs (Overview / Properties / Rules &
  // Calculations) so a field lives under the same tab whether you are
  // viewing or editing it. In focus mode (BlockEditDialog) there are no
  // tabs: just the one card, so `onTab` returns true whenever tabs are not
  // in play — preserving the single-block behaviour.
  const formTabs = [
    { id: "overview" as const, label: "Overview", has: showBasicInfo || showDescription || showRisks || form.type === "table" },
    { id: "properties" as const, label: "Properties", has: showBasicInfo || showLinks || showCapabilities || showNfr },
    { id: "rules" as const, label: "Rules & Calculations", has: showRules },
  ].filter((t) => t.has)
  const activeTab = formTabs.some((t) => t.id === formTab) ? formTab : (formTabs[0]?.id ?? "overview")
  const onTab = (t: "overview" | "properties" | "rules"): boolean => !tabbed || activeTab === t

  const [tagsInput, setTagsInput] = useState(
    initialData?.tags?.join(", ") || ""
  )
  const [risksInput, setRisksInput] = useState(
    initialData?.risks?.join("\n") || ""
  )
  // Per-rule-row "enforced_in" string input for constraint kind.
  const [ruleEnforcedInput, setRuleEnforcedInput] = useState<
    Record<number, string>
  >(() => {
    const initial: Record<number, string> = {}
    initialData?.rules?.forEach((rule, i) => {
      if (rule.enforced_in && rule.enforced_in.length > 0) {
        initial[i] = rule.enforced_in.join(", ")
      }
    })
    return initial
  })

  useEffect(() => {
    // Always-fresh fetch per form mount. AbortController prevents a
    // late response from a previous mount writing back into a new one.
    const controller = new AbortController()
    fetch("/api/components", { signal: controller.signal })
      .then((r) => r.json())
      .then((data: Component[]) => {
        if (controller.signal.aborted) return
        setExistingComponents(
          data.map((c) => ({ id: c.id, name: c.name, type: c.type }))
        )
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return
        console.error(err)
      })
    return () => controller.abort()
  }, [])

  const updateField = <K extends keyof Component>(
    key: K,
    value: Component[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  // v2: single edge primitive. updateLink replaces the legacy
  // updateInterface + updateRelationship pair.
  const updateLink = (
    index: number,
    field: keyof ComponentLink,
    value: string | undefined
  ) => {
    setForm((prev) => ({
      ...prev,
      links: (prev.links ?? []).map((link, i) =>
        i === index ? { ...link, [field]: value } : link
      ),
    }))
  }

  // --- link ordering + live preview helpers ---
  const [showLinkViz, setShowLinkViz] = useState(false)
  const linkNameLookup = useMemo(
    () => new Map(existingComponents.map((c) => [c.id, c.name])),
    [existingComponents]
  )
  const linkLabel = (l: ComponentLink) =>
    (linkNameLookup.get(l.target) || l.target || "").toLowerCase()

  const sortLinksAZ = () => {
    updateField(
      "links",
      [...(form.links ?? [])].sort((a, b) => linkLabel(a).localeCompare(linkLabel(b)))
    )
  }
  const moveLink = (index: number, dir: -1 | 1) => {
    const arr = [...(form.links ?? [])]
    const j = index + dir
    if (j < 0 || j >= arr.length) return
    ;[arr[index], arr[j]] = [arr[j], arr[index]]
    updateField("links", arr)
  }
  const linksViz = useMemo(() => {
    const rels = (form.links ?? [])
      .filter((l) => l.target)
      .map((l) => ({
        target: l.target,
        displayLabel: `${LINK_ROLE_LABELS[l.role] || l.role}${l.name ? ` (${l.name})` : ""}`,
      }))
    return buildRelationshipsMermaid(form, linkNameLookup, rels)
  }, [form, linkNameLookup])

  const updateNFR = (field: keyof ComponentNFR, value: string) => {
    setForm((prev) => ({
      ...prev,
      nfr: { ...prev.nfr, [field]: value || undefined },
    }))
  }

  const updateCapability = (
    index: number,
    field: keyof ComponentCapability,
    value: string
  ) => {
    setForm((prev) => ({
      ...prev,
      capabilities: (prev.capabilities || []).map((cap, i) =>
        i === index ? { ...cap, [field]: value } : cap
      ),
    }))
  }

  const updateRule = (
    index: number,
    field: keyof ComponentRule,
    value: string
  ) => {
    setForm((prev) => ({
      ...prev,
      rules: (prev.rules || []).map((r, i) =>
        i === index ? { ...r, [field]: value } : r
      ),
    }))
  }

  const removeRule = (index: number) => {
    setForm((prev) => ({
      ...prev,
      rules: (prev.rules || []).filter((_, i) => i !== index),
    }))
    setRuleEnforcedInput((prev) => {
      const next: Record<number, string> = {}
      Object.entries(prev).forEach(([k, v]) => {
        const i = Number(k)
        if (i < index) next[i] = v
        else if (i > index) next[i - 1] = v
      })
      return next
    })
  }

  // Swap two rules by index. Mirrors the swap onto the per-row enforced_in
  // input state so the constraint-input value follows the rule it belongs to.
  const moveRule = (index: number, direction: -1 | 1) => {
    const target = index + direction
    setForm((prev) => {
      const rules = [...(prev.rules || [])]
      if (target < 0 || target >= rules.length) return prev
      const tmp = rules[index]
      rules[index] = rules[target]
      rules[target] = tmp
      return { ...prev, rules }
    })
    setRuleEnforcedInput((prev) => {
      const a = prev[index]
      const b = prev[target]
      const next: Record<number, string> = { ...prev }
      if (a === undefined) delete next[target]
      else next[target] = a
      if (b === undefined) delete next[index]
      else next[index] = b
      return next
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    // Clean NFR: remove empty values
    const cleanNfr = form.nfr
      ? Object.fromEntries(Object.entries(form.nfr).filter(([, v]) => v))
      : undefined
    const hasNfr = cleanNfr && Object.keys(cleanNfr).length > 0

    // Clean capabilities: drop rows with empty name; trim description.
    const cleanCapabilities: ComponentCapability[] = (form.capabilities || [])
      .filter((c) => c.name && c.name.trim().length > 0)
      .map((c) => ({
        name: c.name.trim(),
        role: c.role,
        ...(c.description && c.description.trim()
          ? { description: c.description.trim() }
          : {}),
        // Preserve agent-populated provenance through a manual save.
        ...(c.requested ? { requested: c.requested } : {}),
        ...(c.implemented ? { implemented: c.implemented } : {}),
        ...(c.reconciliation ? { reconciliation: c.reconciliation } : {}),
      }))

    // v2 Phase 2: data{} is gone. Every input/output is a link with
    // role reads-from / writes-to (migration in github.ts collapses
    // legacy entries on read, normaliseForSave drops `data` on write).

    // Clean processes: drop rows with empty name; trim activity/description.
    const cleanProcesses: ComponentProcess[] = (form.processes || [])
      .filter((p) => p.name && p.name.trim().length > 0)
      .map((p) => ({
        name: p.name.trim(),
        role: p.role,
        ...(p.activity && p.activity.trim() ? { activity: p.activity.trim() } : {}),
        ...(p.description && p.description.trim()
          ? { description: p.description.trim() }
          : {}),
      }))

    // Clean rules: drop rows with empty name; only keep fields relevant to kind.
    const cleanRules: ComponentRule[] = (form.rules || [])
      .map((r, i) => {
        const name = r.name?.trim() || ""
        if (!name) return null
        const out: ComponentRule = { name, kind: r.kind }
        if (r.summary && r.summary.trim()) out.summary = r.summary.trim()
        if (r.description && r.description.trim()) out.description = r.description.trim()
        if (r.kind === "formula" && r.formula && r.formula.trim()) {
          out.formula = r.formula.trim()
        }
        if (r.kind === "rule") {
          if (r.given && r.given.trim()) out.given = r.given.trim()
          if (r.when && r.when.trim()) out.when = r.when.trim()
          if (r.then && r.then.trim()) out.then = r.then.trim()
        }
        if (r.kind === "constraint") {
          const raw = ruleEnforcedInput[i]
          if (raw && raw.trim()) {
            const ids = raw
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
            if (ids.length > 0) out.enforced_in = ids
          }
        }
        // Preserve agent-populated provenance through a manual save.
        if (r.requested) out.requested = r.requested
        if (r.implemented) out.implemented = r.implemented
        if (r.reconciliation) out.reconciliation = r.reconciliation
        return out
      })
      .filter((x): x is ComponentRule => x !== null)

    // Auto-generate id from name on create when the analyst did not
    // type one. Edit mode keeps the existing id (the input is disabled
    // and the YAML filename cannot change without a rename flow).
    let finalId = form.id.trim()
    if (!isEdit && !finalId) {
      const slug = slugifyForId(form.name)
      finalId = slug || `component-${Date.now().toString(36)}`
    }

    // Clean description: drop every legacy field on save so the YAML
    // migrates to the unified shape. Only the unified `description`
    // survives when non-empty; oneliner / technical / business that
    // existed on the in-memory record (from migrateComponent) are not
    // re-written.
    const cleanDescription: { description?: string } = {}
    if (form.description?.description && form.description.description.trim()) {
      cleanDescription.description = form.description.description.trim()
    }

    const component: Component = {
      ...form,
      id: finalId,
      tags: tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      risks: risksInput
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean),
      // Unified description — legacy technical / business are dropped
      // on save; migrateComponent backfills `description` from them at
      // read time for any YAML that still has the old shape.
      description: cleanDescription,
      capabilities: cleanCapabilities.length > 0 ? cleanCapabilities : undefined,
      // Drop legacy fields on save so the YAML upgrades to v2.
      business_capabilities: undefined,
      data: undefined,
      processes: cleanProcesses.length > 0 ? cleanProcesses : undefined,
      rules: cleanRules.length > 0 ? cleanRules : undefined,
      nfr: hasNfr ? (cleanNfr as ComponentNFR) : undefined,
    }

    try {
      if (isEdit) {
        // Always fetch latest sha before saving to avoid stale sha conflicts
        let latestSha = initialData?.sha
        try {
          const freshRes = await fetch(`/api/components/${component.id}`)
          if (freshRes.ok) {
            const freshData = await freshRes.json()
            latestSha = freshData.sha
          }
        } catch { /* use initialData sha as fallback */ }

        const res = await fetch(`/api/components/${component.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...component, sha: latestSha }),
        })
        if (res.status === 409) {
          // Either someone else holds the edit lock or the component
          // was modified between our load and our save. Either way the
          // analyst's safest next action is to reload and re-apply,
          // so we surface the modal the user signed off on.
          const body = await res.json().catch(() => ({}))
          setConflictMessage(
            body.message ||
              "This component was changed by another user since you opened it. Reload to see the new state, then re-apply your changes."
          )
          setConflictOpen(true)
          return
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          alert(`Failed to save: ${body.error || res.status}`)
          return
        }
      } else {
        await fetch("/api/components", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(component),
        })
      }
      if (onSaveSuccess) {
        onSaveSuccess()
      } else {
        router.push(`/component/${component.id}`)
      }
    } catch (error) {
      console.error("Save failed:", error)
      alert("Failed to save component")
    } finally {
      setSaving(false)
    }
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-6">
      {/*
        <fieldset disabled> is the cleanest way to block every input,
        select, textarea and button below — including dynamically-added
        rule rows — without threading a `disabled` prop through every
        component. The style override removes the default greyed-out
        appearance so the read-only view still reads clearly; the
        outer LockBanner already explains why saves are blocked.
      */}
      <fieldset disabled={readOnly} className="space-y-6 contents">
      {/* Tab nav — mirrors the component view's tabs for consistency.
          Only shown on the full form; the focused single-block dialog has
          no tabs. */}
      {tabbed && formTabs.length > 1 && (
        <div className="border-b">
          <nav className="-mb-px flex gap-1 flex-wrap" role="tablist">
            {formTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                onClick={() => setFormTab(t.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === t.id
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-gray-300"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      )}
      {/* Basic Info — hidden in focus mode (BlockEditDialog) since
          identity-level fields are edited only via the full Edit page. */}
      {showBasicInfo && onTab("overview") && (
      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
          <p className="text-sm text-muted-foreground">
            Only <strong>Name</strong> is required. Everything else —
            type, status, owner, tags, description — is optional. The
            component id is auto-generated from the name; open
            &ldquo;Advanced&rdquo; to customise it.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Name is the only required field for a new component.
              The id is auto-generated from the name on save unless the
              analyst opens the "Advanced" panel and types one. Edit
              mode locks the id because changing it would rename the
              backing YAML file. */}
          <div className="space-y-2">
            <Label htmlFor="name">Name <span className="text-destructive">*</span></Label>
            <Input
              id="name"
              placeholder="e.g. Authentication Service"
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              required
            />
            {!isEdit && (
              <div className="text-xs text-muted-foreground">
                ID:{" "}
                <code className="font-mono">
                  {form.id || slugifyForId(form.name) || "(type a name first)"}
                </code>
              </div>
            )}
          </div>
          {isEdit && (
            <div className="space-y-2">
              <Label htmlFor="id">Component ID</Label>
              <Input
                id="id"
                value={form.id}
                disabled
                className="font-mono"
              />
            </div>
          )}
          {!isEdit && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground py-1">
                Advanced — customize component id
              </summary>
              <div className="mt-2 space-y-2">
                <Label htmlFor="id">Component ID (optional)</Label>
                <Input
                  id="id"
                  placeholder={
                    slugifyForId(form.name) || "auto-generated from name"
                  }
                  value={form.id}
                  onChange={(e) => updateField("id", e.target.value)}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to use the auto-generated slug. Only
                  letters, digits, dashes and underscores; this becomes
                  the YAML filename and the URL slug for the component.
                </p>
              </div>
            </details>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={form.type}
                onValueChange={(v) =>
                  updateField("type", v as Component["type"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPONENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) =>
                  updateField("status", v as Component["status"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPONENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="owner">Owner</Label>
              <Input
                id="owner"
                placeholder="e.g. platform-team (optional)"
                value={form.owner}
                onChange={(e) => updateField("owner", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tags">Tags (comma-separated)</Label>
              <Input
                id="tags"
                placeholder="e.g. auth, security, critical"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Description — single unified field. Legacy YAML with separate
          technical + business sections (and / or oneliner) is merged
          into this on load via migrateComponent; the next save persists
          only the unified field and drops the legacy ones. */}
      {showDescription && onTab("overview") && (
      <Card>
        <CardHeader>
          <CardTitle>Description</CardTitle>
          <p className="text-sm text-muted-foreground">
            One free-form description. Capture purpose, behaviour and
            any context an analyst would want to know — for any
            audience. Existing components that still carry separate
            technical / business / one-liner content are merged into
            this single field on load; the next save persists only the
            unified text.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="What does this component do? Why does it exist? Who depends on it? Anything an architect or analyst should know at a glance."
              value={form.description.description || ""}
              onChange={(e) =>
                updateField("description", {
                  ...form.description,
                  description: e.target.value,
                })
              }
              rows={8}
            />
          </div>
        </CardContent>
      </Card>
      )}

      {/* Data model registry link — only meaningful on table-type
          components. The card itself silently hides when the
          deployment does not have the registry configured, so an
          OSS install without the integration sees nothing. */}
      {form.type === "table" && onTab("overview") && (
        <DataModelLinkCard
          entity={form.data_model?.entity}
          onChange={(entity) =>
            updateField("data_model", entity ? { entity } : undefined)
          }
        />
      )}

      {/* Source code mapping — self-hides when the source-code connection
          is not configured (SRC_ADO_*). Feeds DSD generation grounding.
          Shown only on the full New/Edit page, not the per-block dialog. */}
      {showBasicInfo && onTab("properties") && (
        <SourceCodeCard
          source={form.source}
          onChange={(s) => updateField("source", s)}
        />
      )}

      {/* Links — v2 single edge primitive that replaces the legacy
          Interfaces + Relationships sections. One row per edge: pick
          the target, choose a role (calls / serves / part-of /
          contains / reads-from / writes-to), optionally pick a
          protocol (rest / grpc / async / db / file / human / info /
          link / data), give it a short name and a description. */}
      {showLinks && onTab("properties") && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
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
                    Mirror pairs (calls ↔ serves, part-of ↔ contains) are
                    deduped in the diagram and the consistency check
                    flags missing mirrors.
                  </p>
                </TooltipContent>
              </Tooltip>
            </CardTitle>
            <div className="flex items-center gap-2">
              {(form.links ?? []).length > 1 && (
                <Button type="button" variant="outline" size="sm" onClick={sortLinksAZ} title="Sort links A–Z by target">
                  <ArrowDownAZ className="h-4 w-4 mr-1" />
                  Sort A–Z
                </Button>
              )}
              {(form.links ?? []).length > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={() => setShowLinkViz((v) => !v)}>
                  {showLinkViz ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
                  {showLinkViz ? "Hide" : "Preview"}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  updateField("links", [
                    ...(form.links ?? []),
                    { ...emptyLink },
                  ])
                }
              >
                <Plus className="h-4 w-4 mr-1" />
                Add link
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {(form.links ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                No links defined yet.
              </p>
            )}
            {(form.links ?? []).map((link, i) => (
              <div
                key={i}
                className="space-y-2 border-l-2 border-muted pl-3 py-2"
              >
                <div className="grid grid-cols-[1fr_140px_110px_auto] gap-2 items-end">
                  <div>
                    <Label className="text-xs">Target</Label>
                    <ComponentTargetPicker
                      value={link.target}
                      onChange={(v) => updateLink(i, "target", v)}
                      placeholder="Component or external label"
                      excludeId={form.id}
                      components={existingComponents}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Role</Label>
                    <Select
                      value={link.role}
                      onValueChange={(v) =>
                        updateLink(i, "role", v as ComponentLink["role"])
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LINK_ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {LINK_ROLE_LABELS[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Protocol</Label>
                    <Select
                      value={link.protocol || "none"}
                      onValueChange={(v) =>
                        updateLink(
                          i,
                          "protocol",
                          v === "none"
                            ? undefined
                            : (v as ComponentLink["protocol"])
                        )
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">
                          <span className="text-muted-foreground">(none)</span>
                        </SelectItem>
                        {LINK_PROTOCOLS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-7"
                      disabled={i === 0}
                      title="Move up"
                      onClick={() => moveLink(i, -1)}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-7"
                      disabled={i === (form.links ?? []).length - 1}
                      title="Move down"
                      onClick={() => moveLink(i, 1)}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      title="Remove link"
                      onClick={() =>
                        updateField(
                          "links",
                          (form.links ?? []).filter((_, idx) => idx !== i)
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_2fr] gap-2">
                  <div>
                    <Label className="text-xs">Name (optional)</Label>
                    <Input
                      className="h-9"
                      placeholder="e.g. Orders API, Stock feed"
                      value={link.name || ""}
                      onChange={(e) =>
                        updateLink(i, "name", e.target.value || undefined)
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Description (optional)</Label>
                    <Input
                      className="h-9"
                      placeholder="What happens on this edge"
                      value={link.description || ""}
                      onChange={(e) =>
                        updateLink(i, "description", e.target.value || undefined)
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
            {showLinkViz && (form.links ?? []).length > 0 && (
              <div className="border-t pt-3 mt-2">
                <p className="text-xs text-muted-foreground mb-2">
                  Live preview — updates as you edit (no save needed).
                </p>
                <MermaidPreview chart={linksViz} className="w-full" />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Capabilities */}
      {showCapabilities && onTab("properties") && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Capabilities
            <Tooltip>
              <TooltipTrigger className="cursor-help">
                <Info className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs text-left">
                <p className="font-semibold mb-1">Which business capabilities this component supports — and the role it plays.</p>
                <ul className="text-xs space-y-0.5">
                  <li><strong>Owner</strong> — implements the capability</li>
                  <li><strong>Contributor</strong> — assists (e.g., logs, metrics)</li>
                  <li><strong>Consumer</strong> — uses the capability</li>
                  <li><strong>Indirect</strong> — touches it incidentally (e.g., a gateway routing requests)</li>
                </ul>
              </TooltipContent>
            </Tooltip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <datalist id="capability-suggestions">
            {BUSINESS_CAPABILITIES.map((cap) => (
              <option key={cap} value={cap} />
            ))}
          </datalist>
          {(form.capabilities || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No capabilities defined.
            </p>
          ) : (
            (form.capabilities || []).map((cap, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr,auto,1.5fr,auto] gap-2 items-start"
              >
                <Input
                  list="capability-suggestions"
                  placeholder="Capability name"
                  value={cap.name}
                  onChange={(e) => updateCapability(i, "name", e.target.value)}
                  className="h-9"
                />
                <Select
                  value={cap.role}
                  onValueChange={(v) =>
                    updateCapability(i, "role", v as CapabilityRole)
                  }
                >
                  <SelectTrigger className="h-9 w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CAPABILITY_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {CAPABILITY_ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Description (optional)"
                  value={cap.description || ""}
                  onChange={(e) =>
                    updateCapability(i, "description", e.target.value)
                  }
                  className="h-9"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() =>
                    updateField(
                      "capabilities",
                      (form.capabilities || []).filter((_, idx) => idx !== i)
                    )
                  }
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              updateField("capabilities", [
                ...(form.capabilities || []),
                { ...emptyCapability },
              ])
            }
          >
            <Plus className="h-4 w-4 mr-1" />
            Add capability
          </Button>
        </CardContent>
      </Card>

      )}


      {/* Rules & Calculations */}
      {showRules && onTab("rules") && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Rules &amp; Calculations
            <Tooltip>
              <TooltipTrigger className="cursor-help">
                <Info className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-sm text-left">
                <p className="font-semibold mb-1">Business logic this component implements:</p>
                <ul className="text-xs space-y-0.5">
                  <li><strong>Formula</strong> — a calculation, e.g. <code>total = base * (1 + rate)</code></li>
                  <li><strong>Rule</strong> — Given / When / Then behavior</li>
                  <li><strong>Constraint</strong> — invariant that must always hold</li>
                </ul>
              </TooltipContent>
            </Tooltip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(form.rules || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No rules defined.</p>
          ) : (
            (form.rules || []).map((r, i, arr) => (
              <div
                key={i}
                className="rounded-md border bg-muted/20 p-3 space-y-2"
              >
                <div className="grid grid-cols-[1.4fr,auto,auto,auto,auto] gap-2 items-start">
                  <Input
                    placeholder="Rule name (e.g. Total calculation)"
                    value={r.name}
                    onChange={(e) => updateRule(i, "name", e.target.value)}
                    className="h-9"
                  />
                  <Select
                    value={r.kind}
                    onValueChange={(v) => updateRule(i, "kind", v as RuleKind)}
                  >
                    <SelectTrigger className="h-9 w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RULE_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {RULE_KIND_LABELS[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => moveRule(i, -1)}
                    disabled={i === 0}
                    aria-label="Move rule up"
                    title="Move up"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => moveRule(i, 1)}
                    disabled={i === arr.length - 1}
                    aria-label="Move rule down"
                    title="Move down"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => removeRule(i)}
                    aria-label="Remove rule"
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground italic">
                  {RULE_KIND_HINTS[r.kind]}
                </p>
                <Input
                  placeholder="Summary (one line)"
                  value={r.summary || ""}
                  onChange={(e) => updateRule(i, "summary", e.target.value)}
                  className="h-9"
                />
                {r.kind === "formula" && (
                  <Input
                    placeholder="Formula — e.g. total = base * (1 + rate)"
                    value={r.formula || ""}
                    onChange={(e) => updateRule(i, "formula", e.target.value)}
                    className="h-9 font-mono text-xs"
                  />
                )}
                {r.kind === "rule" && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Input
                      placeholder="Given (precondition)"
                      value={r.given || ""}
                      onChange={(e) => updateRule(i, "given", e.target.value)}
                      className="h-9"
                    />
                    <Input
                      placeholder="When (trigger)"
                      value={r.when || ""}
                      onChange={(e) => updateRule(i, "when", e.target.value)}
                      className="h-9"
                    />
                    <Input
                      placeholder="Then (outcome)"
                      value={r.then || ""}
                      onChange={(e) => updateRule(i, "then", e.target.value)}
                      className="h-9"
                    />
                  </div>
                )}
                {r.kind === "constraint" && (
                  <Input
                    placeholder="Enforced in — comma-separated component ids (optional)"
                    value={ruleEnforcedInput[i] || ""}
                    onChange={(e) =>
                      setRuleEnforcedInput((prev) => ({
                        ...prev,
                        [i]: e.target.value,
                      }))
                    }
                    className="h-9"
                  />
                )}
                <Textarea
                  placeholder="Detailed description (optional)"
                  value={r.description || ""}
                  onChange={(e) => updateRule(i, "description", e.target.value)}
                  rows={4}
                  className="min-h-[160px] resize-y"
                />
              </div>
            ))
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              updateField("rules", [...(form.rules || []), { ...emptyRule }])
            }
          >
            <Plus className="h-4 w-4 mr-1" />
            Add rule
          </Button>
        </CardContent>
      </Card>

      )}

      {/* Non-Functional Requirements */}
      {showNfr && onTab("properties") && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Non-Functional Requirements
            <Tooltip>
              <TooltipTrigger className="cursor-help">
                <Info className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                Define availability, performance, and data requirements. All fields are optional — fill in what you know.
              </TooltipContent>
            </Tooltip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nfr-availability">Availability Target</Label>
              <Input
                id="nfr-availability"
                placeholder="e.g. 99.9%"
                value={form.nfr?.availability || ""}
                onChange={(e) => updateNFR("availability", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nfr-rto">RTO (Recovery Time)</Label>
              <Input
                id="nfr-rto"
                placeholder="e.g. 4h"
                value={form.nfr?.rto || ""}
                onChange={(e) => updateNFR("rto", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nfr-rpo">RPO (Recovery Point)</Label>
              <Input
                id="nfr-rpo"
                placeholder="e.g. 1h"
                value={form.nfr?.rpo || ""}
                onChange={(e) => updateNFR("rpo", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nfr-latency">Max Latency</Label>
              <Input
                id="nfr-latency"
                placeholder="e.g. 200ms"
                value={form.nfr?.max_latency || ""}
                onChange={(e) => updateNFR("max_latency", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nfr-throughput">Throughput</Label>
              <Input
                id="nfr-throughput"
                placeholder="e.g. 1000 req/s"
                value={form.nfr?.throughput || ""}
                onChange={(e) => updateNFR("throughput", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Data Classification</Label>
              <Select
                value={form.nfr?.data_classification || "none"}
                onValueChange={(v) => updateNFR("data_classification", v === "none" ? "" : v)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground">Not set</span>
                  </SelectItem>
                  {DATA_CLASSIFICATIONS.map((dc) => (
                    <SelectItem key={dc} value={dc}>
                      {DATA_CLASSIFICATION_LABELS[dc]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Scaling Model</Label>
              <Select
                value={form.nfr?.scaling || "_notset"}
                onValueChange={(v) => updateNFR("scaling", v === "_notset" ? "" : v)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_notset">
                    <span className="text-muted-foreground">Not set</span>
                  </SelectItem>
                  {SCALING_MODELS.map((sm) => (
                    <SelectItem key={sm} value={sm}>
                      {sm.charAt(0).toUpperCase() + sm.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      )}

      {/* Risks */}
      {showRisks && onTab("overview") && (
      <Card>
        <CardHeader>
          <CardTitle>Risks</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="One risk per line..."
            value={risksInput}
            onChange={(e) => setRisksInput(e.target.value)}
            rows={4}
          />
        </CardContent>
      </Card>
      )}

      </fieldset>

      {/* Save-conflict modal — surfaced when the server returns 409
          (someone else edited or holds the lock). User chooses Reload
          (re-fetch + replace form state, losing unsaved local edits)
          or Cancel (keep the form state and try saving again later). */}
      <Dialog open={conflictOpen} onOpenChange={setConflictOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              Component changed by another user
            </DialogTitle>
            <DialogDescription className="text-sm pt-2">
              {conflictMessage}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setConflictOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConflictOpen(false)
                if (initialData?.id) {
                  router.push(`/component/${initialData.id}`)
                  router.refresh()
                }
              }}
            >
              Reload
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Submit lives in the page header — see edit/[id]/page.tsx and
          new/page.tsx, which render Cancel + Save buttons that target
          this form via `<button type="submit" form={formId}>`. The
          old bottom-of-form buttons were too easy to miss on a long
          form. */}
    </form>
  )
}
