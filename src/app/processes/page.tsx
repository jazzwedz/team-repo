"use client"

// Processes — the single, derived view of the one process concept.
//
// A process IS the editable sequence modelled on a solution. This page is a
// read-only catalog-wide index DERIVED from those sequences: for each
// process name it shows the participants (the sequence actors, with their
// roles) and the solutions that model it. There is no separate process
// registry or per-component process tag any more — edit a process by
// editing its sequence on a solution.

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Workflow, Loader2, AlertCircle, Search, GitBranch } from "lucide-react"
import { PROCESS_ROLES, PROCESS_ROLE_LABELS, PROCESS_ROLE_COLORS } from "@/lib/constants"
import type { Component, ProcessRole, Solution } from "@/lib/types"

interface Participant {
  id: string
  label: string
  /** Catalog component id when this participant is a member (links out). */
  component?: string
  roles: Set<ProcessRole>
}
interface ModelRef {
  id: string
  name: string
  steps: number
}
interface ProcessGroup {
  name: string
  participants: Map<string, Participant>
  modelledBy: ModelRef[]
}

const ROLE_ORDER = new Map(PROCESS_ROLES.map((r, i) => [r, i]))

export default function ProcessesPage() {
  const [components, setComponents] = useState<Component[]>([])
  const [solutions, setSolutions] = useState<Solution[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      fetch("/api/components").then(async (r) => {
        const data = await r.json().catch(() => null)
        return Array.isArray(data) ? (data as Component[]) : []
      }),
      fetch("/api/solutions").then(async (r) => {
        const data = await r.json().catch(() => null)
        if (!r.ok) throw new Error((data && data.error) || `Request failed (${r.status})`)
        return Array.isArray(data) ? (data as Solution[]) : []
      }),
    ])
      .then(([comps, sols]) => {
        setComponents(comps)
        setSolutions(sols)
      })
      .catch((err: Error) => setError(err.message || "Failed to load"))
      .finally(() => setLoading(false))
  }, [])

  const compName = useMemo(() => new Map(components.map((c) => [c.id, c.name])), [components])

  const groups = useMemo<ProcessGroup[]>(() => {
    const map = new Map<string, ProcessGroup>()
    for (const s of solutions) {
      for (const p of s.processes || []) {
        const name = (p.name || "").trim()
        if (!name) continue
        const key = name.toLowerCase()
        let g = map.get(key)
        if (!g) {
          g = { name, participants: new Map(), modelledBy: [] }
          map.set(key, g)
        }
        g.modelledBy.push({ id: s.id, name: s.name, steps: p.steps?.length || 0 })
        for (const a of p.actors || []) {
          const pid = a.component || a.id
          let part = g.participants.get(pid)
          if (!part) {
            part = {
              id: pid,
              label: a.component ? compName.get(a.component) || a.label : a.label,
              component: a.component,
              roles: new Set(),
            }
            g.participants.set(pid, part)
          }
          if (a.role) part.roles.add(a.role)
        }
      }
    }
    const out = Array.from(map.values())
    out.sort((a, b) => a.name.localeCompare(b.name))
    return out
  }, [solutions, compName])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return groups
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.modelledBy.some((m) => m.name.toLowerCase().includes(q)) ||
        Array.from(g.participants.values()).some((p) => p.label.toLowerCase().includes(q))
    )
  }, [groups, search])

  const sortedRoles = (roles: Set<ProcessRole>) =>
    Array.from(roles).sort((a, b) => (ROLE_ORDER.get(a) ?? 99) - (ROLE_ORDER.get(b) ?? 99))

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Workflow className="h-7 w-7" />
            Processes
          </h1>
          <p className="text-muted-foreground mt-1">
            {loading
              ? "Loading…"
              : `${groups.length} process${groups.length === 1 ? "" : "es"} modelled across solutions`}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter processes, participants or solutions…"
            className="pl-8"
          />
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {!loading && !error && groups.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Workflow className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>No processes yet.</p>
          <p className="text-sm mt-1">
            A process is a <span className="font-medium">sequence</span> modelled on a solution —
            open a solution, go to the Processes tab, and add one.
          </p>
        </div>
      )}

      {!loading && !error && groups.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((g) => {
            const participants = Array.from(g.participants.values())
            return (
              <Card key={g.name}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-lg">{g.name}</CardTitle>
                    <Badge variant="outline" className="shrink-0">
                      {participants.length} participant{participants.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {participants.length > 0 && (
                    <ul className="space-y-1.5">
                      {participants.map((p) => (
                        <li key={p.id} className="flex items-center gap-2 text-sm flex-wrap">
                          {p.component ? (
                            <Link href={`/component/${p.component}`} className="font-medium hover:underline">
                              {p.label}
                            </Link>
                          ) : (
                            <span className="font-medium italic">{p.label}</span>
                          )}
                          {sortedRoles(p.roles).map((r) => (
                            <Badge key={r} variant="outline" className={`text-[10px] ${PROCESS_ROLE_COLORS[r] || ""}`}>
                              {PROCESS_ROLE_LABELS[r] || r}
                            </Badge>
                          ))}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="rounded-md border bg-muted/20 p-2 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <GitBranch className="h-3.5 w-3.5" />Modelled in
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {g.modelledBy.map((m, i) => (
                        <Link
                          key={`${m.id}-${i}`}
                          href={`/solutions/${m.id}`}
                          className="inline-flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-xs hover:underline"
                        >
                          {m.name}
                          <span className="text-[10px] text-muted-foreground">· {m.steps} steps</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground col-span-full py-8 text-center">
              No processes match “{search}”.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
