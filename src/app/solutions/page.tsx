"use client"

// Solutions list — every composed solution in the repo. A solution is a
// cross-cutting composition over existing components (see
// docs/SOLUTIONS.md). Read-only list; detail lives at /solutions/[id].

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Boxes, Loader2, AlertCircle, Search, Plus } from "lucide-react"
import { SOLUTION_STATUS_COLORS } from "@/lib/constants"
import type { Solution } from "@/lib/types"

export default function SolutionsPage() {
  const [solutions, setSolutions] = useState<Solution[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch("/api/solutions")
      .then(async (r) => {
        const data = await r.json().catch(() => null)
        if (!r.ok) {
          const msg =
            data && typeof data === "object" && "error" in data
              ? String((data as { error: unknown }).error)
              : `Request failed (${r.status})`
          throw new Error(msg)
        }
        return data
      })
      .then((data) => setSolutions(Array.isArray(data) ? data : []))
      .catch((err: Error) => setError(err.message || "Failed to load"))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const sorted = [...solutions].sort((a, b) => a.name.localeCompare(b.name))
    if (!q) return sorted
    return sorted.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.goal || "").toLowerCase().includes(q) ||
        (s.delivers?.capabilities || []).some((c) => c.toLowerCase().includes(q))
    )
  }, [solutions, search])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Boxes className="h-7 w-7" />
            Solutions
          </h1>
          <p className="text-muted-foreground mt-1">
            {loading
              ? "Loading…"
              : `${solutions.length} solution${solutions.length === 1 ? "" : "s"} composed from catalog components`}
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter solutions…"
              className="pl-8"
            />
          </div>
          <Link href="/solutions/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New solution
            </Button>
          </Link>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading solutions…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {!loading && !error && solutions.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Boxes className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>No solutions yet.</p>
          <p className="text-sm mt-1">
            A solution composes existing components into a new offering — pick
            what to reuse, fill the gaps, describe the flows.
          </p>
        </div>
      )}

      {!loading && !error && solutions.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <Link key={s.id} href={`/solutions/${s.id}`} className="block">
              <Card className="h-full hover:border-foreground/30 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-lg truncate">{s.name}</CardTitle>
                    <Badge
                      variant="outline"
                      className={`shrink-0 text-[10px] uppercase ${SOLUTION_STATUS_COLORS[s.status] || ""}`}
                    >
                      {s.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {s.goal && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{s.goal}</p>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {(s.members?.length ?? 0)} component
                    {(s.members?.length ?? 0) === 1 ? "" : "s"}
                  </div>
                  {(s.delivers?.capabilities?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {s.delivers!.capabilities!.slice(0, 4).map((c) => (
                        <Badge key={c} variant="outline" className="text-[10px]">
                          {c}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground col-span-full py-8 text-center">
              No solutions match “{search}”.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
