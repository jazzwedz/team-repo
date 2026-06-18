"use client"

import { useEffect, useState, useMemo } from "react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ComponentCard } from "@/components/ComponentCard"
import { COMPONENT_TYPES, COMPONENT_STATUSES, TYPE_LABELS, TYPE_COLORS } from "@/lib/constants"
import type { Component, ComponentType } from "@/lib/types"
import { Search, LayoutGrid, List, Plus, Grid3X3, Group } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TypeIcon } from "@/components/TypeIcon"
import { TypeModelDialog } from "@/components/TypeModelDialog"
import { ImportComponentDialog } from "@/components/ImportComponentDialog"
import { ConsistencyCheckDialog } from "@/components/ConsistencyCheckDialog"
import { CatalogCuratorDialog } from "@/components/CatalogCuratorDialog"
import { ArchitectureDiagramDialog } from "@/components/ArchitectureDiagramDialog"
import { CatalogExportDialog } from "@/components/CatalogExportDialog"
import { ExportYamlButton } from "@/components/ExportYamlButton"
import { useStoredState } from "@/lib/use-stored-state"
import Link from "next/link"

type ViewMode = "grid" | "list" | "compact"
type GroupMode = "none" | "type" | "context"

// Build child→parent map from the part-of / contains link pair (same
// rule as the architecture overview). Used to roll a component up to its
// owning context.
function buildParentMap(components: Component[]): Map<string, string> {
  const ids = new Set(components.map((c) => c.id))
  const parentOf = new Map<string, string>()
  for (const c of components)
    for (const l of c.links || [])
      if (l.role === "part-of" && l.target !== c.id && ids.has(l.target) && !parentOf.has(c.id))
        parentOf.set(c.id, l.target)
  for (const c of components)
    for (const l of c.links || [])
      if (l.role === "contains" && l.target !== c.id && ids.has(l.target) && !parentOf.has(l.target))
        parentOf.set(l.target, c.id)
  return parentOf
}

// Walk up the hierarchy to the nearest context-typed ancestor (or self).
// Returns null when the component rolls up to no context.
function contextIdOf(
  id: string,
  byId: Map<string, Component>,
  parentOf: Map<string, string>
): string | null {
  let cur: string | undefined = id
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    if (byId.get(cur)?.type === "context") return cur
    cur = parentOf.get(cur)
  }
  return null
}

export default function CatalogPage() {
  const [components, setComponents] = useState<Component[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Catalog view preferences are persisted per-browser via localStorage
  // so the analyst's filters / view mode / grouping survive reloads,
  // navigation into a component detail and back, and tab swaps.
  const [search, setSearch] = useStoredState("catalog:search", "")
  const [typeFilter, setTypeFilter] = useStoredState<string>("catalog:typeFilter", "all")
  const [statusFilter, setStatusFilter] = useStoredState<string>("catalog:statusFilter", "all")
  const [ownerFilter, setOwnerFilter] = useStoredState<string>("catalog:ownerFilter", "all")
  const [tagFilter, setTagFilter] = useStoredState<string>("catalog:tagFilter", "all")
  const [view, setView] = useStoredState<ViewMode>("catalog:view", "grid")
  const [groupBy, setGroupBy] = useStoredState<GroupMode>("catalog:groupBy", "none")

  useEffect(() => {
    fetch("/api/components")
      .then(async (r) => {
        const data = await r.json().catch(() => null)
        if (!r.ok) {
          const msg = data && typeof data === "object" && "error" in data ? String(data.error) : `Request failed (${r.status})`
          throw new Error(msg)
        }
        return data
      })
      .then((data) => setComponents(Array.isArray(data) ? data : []))
      .catch((err: Error) => {
        console.error("Failed to load components:", err)
        setLoadError(err.message || "Failed to load components")
      })
      .finally(() => setLoading(false))
  }, [])

  const allOwners = useMemo(
    () => Array.from(new Set(components.map((c) => c.owner).filter(Boolean))).sort(),
    [components]
  )

  const allTags = useMemo(
    () => Array.from(new Set(components.flatMap((c) => c.tags))).sort(),
    [components]
  )

  const filtered = useMemo(() => {
    return components.filter((c) => {
      const matchesSearch =
        !search ||
        c.id.toLowerCase().includes(search.toLowerCase()) ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.description?.oneliner || "").toLowerCase().includes(search.toLowerCase()) ||
        (c.description?.description || "").toLowerCase().includes(search.toLowerCase())

      const matchesType = typeFilter === "all" || c.type === typeFilter
      const matchesStatus = statusFilter === "all" || c.status === statusFilter
      const matchesOwner = ownerFilter === "all" || c.owner === ownerFilter
      const matchesTag = tagFilter === "all" || c.tags.includes(tagFilter)

      return matchesSearch && matchesType && matchesStatus && matchesOwner && matchesTag
    })
  }, [components, search, typeFilter, statusFilter, ownerFilter, tagFilter])

  const grouped = useMemo(() => {
    const groups: Partial<Record<ComponentType, Component[]>> = {}
    for (const c of filtered) {
      if (!groups[c.type]) groups[c.type] = []
      groups[c.type]!.push(c)
    }
    return COMPONENT_TYPES
      .filter((t) => groups[t] && groups[t]!.length > 0)
      .map((t) => ({ type: t, components: groups[t]! }))
  }, [filtered])

  // Group by owning context. Hierarchy is resolved from the FULL catalog
  // (a parent context may itself be filtered out of the visible list).
  const groupedByContext = useMemo(() => {
    const byId = new Map(components.map((c) => [c.id, c]))
    const parentOf = buildParentMap(components)
    const groups = new Map<string, Component[]>()
    const NONE = "__none"
    for (const c of filtered) {
      const ctx = contextIdOf(c.id, byId, parentOf) ?? NONE
      const arr = groups.get(ctx)
      if (arr) arr.push(c)
      else groups.set(ctx, [c])
    }
    const out = Array.from(groups.entries()).map(([ctxId, comps]) => ({
      contextId: ctxId,
      contextName: ctxId === NONE ? "No context" : byId.get(ctxId)?.name || ctxId,
      isNone: ctxId === NONE,
      components: comps,
    }))
    // Real contexts first (by name), "No context" last.
    out.sort((a, b) => {
      if (a.isNone) return 1
      if (b.isNone) return -1
      return a.contextName.localeCompare(b.contextName)
    })
    return out
  }, [filtered, components])

  const viewButtons: { mode: ViewMode; icon: typeof LayoutGrid; title: string }[] = [
    { mode: "grid", icon: LayoutGrid, title: "Cards" },
    { mode: "compact", icon: Grid3X3, title: "Tiles" },
    { mode: "list", icon: List, title: "List" },
  ]

  function renderComponents(items: Component[]) {
    if (view === "grid") {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((c) => (
            <ComponentCard key={c.id} component={c} />
          ))}
        </div>
      )
    }
    if (view === "compact") {
      return (
        <div className="flex flex-wrap gap-2">
          {items.map((c) => (
            <ComponentCard key={c.id} component={c} compact />
          ))}
        </div>
      )
    }
    // list
    return (
      <div className="space-y-2">
        {items.map((c) => (
          <ComponentCard key={c.id} component={c} />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Component Catalog</h1>
          <p className="text-muted-foreground mt-1">
            {components.length} components registered
          </p>
        </div>
        <div className="flex gap-2">
          <ArchitectureDiagramDialog />
          <ConsistencyCheckDialog />
          <CatalogCuratorDialog />
          <CatalogExportDialog />
          <ExportYamlButton />
          <ImportComponentDialog />
          <Link href="/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Component
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by ID, name, or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {COMPONENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {COMPONENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {allOwners.length > 0 && (
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Owner" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All owners</SelectItem>
              {allOwners.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {allTags.length > 0 && (
          <Select value={tagFilter} onValueChange={setTagFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Tag" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tags</SelectItem>
              {allTags.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex gap-1 border rounded-md p-1">
          {viewButtons.map(({ mode, icon: Icon, title }) => (
            <Button
              key={mode}
              variant={view === mode ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setView(mode)}
              title={title}
            >
              <Icon className="h-4 w-4" />
            </Button>
          ))}
        </div>
        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupMode)}>
          <SelectTrigger className="w-[160px]">
            <Group className="h-4 w-4 mr-1 text-muted-foreground" />
            <SelectValue placeholder="Group" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No grouping</SelectItem>
            <SelectItem value="context">Group by context</SelectItem>
            <SelectItem value="type">Group by type</SelectItem>
          </SelectContent>
        </Select>
        <TypeModelDialog />
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">
          Loading components...
        </div>
      ) : loadError ? (
        <div className="text-center py-12 space-y-2">
          <p className="text-destructive font-medium">Failed to load components</p>
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <p className="text-xs text-muted-foreground">
            Check that GITHUB_TOKEN, GITHUB_OWNER and GITHUB_REPO are configured correctly on the server.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {components.length === 0
            ? "No components yet. Create your first one!"
            : "No components match your filters."}
        </div>
      ) : groupBy === "type" ? (
        <div className="space-y-8">
          {grouped.map(({ type, components: groupComponents }) => {
            const colors = TYPE_COLORS[type]
            return (
              <div key={type}>
                <div
                  className="flex items-center gap-2 mb-3 pb-2 border-b-2"
                  style={{ borderBottomColor: colors.border }}
                >
                  <TypeIcon type={type} style={{ color: colors.text }} />
                  <h2 className="text-lg font-semibold" style={{ color: colors.text }}>
                    {TYPE_LABELS[type]}
                  </h2>
                  <span className="text-sm text-muted-foreground ml-1">
                    ({groupComponents.length})
                  </span>
                </div>
                {renderComponents(groupComponents)}
              </div>
            )
          })}
        </div>
      ) : groupBy === "context" ? (
        <div className="space-y-8">
          {groupedByContext.map(({ contextId, contextName, isNone, components: groupComponents }) => {
            const colors = TYPE_COLORS.context
            return (
              <div key={contextId}>
                <div
                  className="flex items-center gap-2 mb-3 pb-2 border-b-2"
                  style={{ borderBottomColor: isNone ? "#d1d5db" : colors.border }}
                >
                  {!isNone && <TypeIcon type="context" style={{ color: colors.text }} />}
                  {isNone ? (
                    <h2 className="text-lg font-semibold text-muted-foreground">No context</h2>
                  ) : (
                    <Link
                      href={`/component/${contextId}`}
                      className="text-lg font-semibold hover:underline"
                      style={{ color: colors.text }}
                    >
                      {contextName}
                    </Link>
                  )}
                  <span className="text-sm text-muted-foreground ml-1">
                    ({groupComponents.length})
                  </span>
                </div>
                {renderComponents(groupComponents)}
              </div>
            )
          })}
        </div>
      ) : (
        renderComponents(filtered)
      )}
    </div>
  )
}
