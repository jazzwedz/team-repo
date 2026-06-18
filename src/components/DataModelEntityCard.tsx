"use client"

// Detail-page card — fetches the live attribute list + relationships
// for the linked entity from the data model registry and renders them
// alongside the component. Read-only by design (one-way pull); the
// component is never modified by this view. A Resync button bypasses
// the in-memory cache by appending a cache-bust query.

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Database, RefreshCw, AlertTriangle, Loader2 } from "lucide-react"

interface Attribute {
  name: string
  type: string
  nullable?: boolean
}

interface Relationship {
  parent: string
  child: string
  type?: string
}

interface EntityResponse {
  ok: boolean
  entity?: { entity: string; attributes: Attribute[]; version?: string; zone?: string }
  zone?: string
  error?: string
  message?: string
}

interface RelationshipsResponse {
  ok: boolean
  relationships?: Relationship[]
  error?: string
  message?: string
}

interface Props {
  entityName: string
}

export function DataModelEntityCard({ entityName }: Props) {
  const [loading, setLoading] = useState(true)
  const [entity, setEntity] = useState<EntityResponse["entity"] | null>(null)
  const [zone, setZone] = useState<string | undefined>(undefined)
  const [relationships, setRelationships] = useState<Relationship[]>([])
  const [error, setError] = useState<string | null>(null)
  const [lastFetched, setLastFetched] = useState<Date | null>(null)

  const load = useCallback(
    async (bust = false) => {
      setLoading(true)
      setError(null)
      try {
        const params = bust ? `?t=${Date.now()}` : ""
        const [entityRes, relRes] = await Promise.all([
          fetch(
            `/api/data-model/entity/${encodeURIComponent(entityName)}${params}`,
            { cache: bust ? "no-store" : "default" }
          ),
          fetch(
            `/api/data-model/relationships/${encodeURIComponent(entityName)}${params}`,
            { cache: bust ? "no-store" : "default" }
          ),
        ])
        const entityData = (await entityRes.json()) as EntityResponse
        const relData = (await relRes.json()) as RelationshipsResponse
        if (!entityData.ok) {
          setError(entityData.message || entityData.error || "Failed to fetch entity.")
          setEntity(null)
        } else {
          setEntity(entityData.entity || null)
          setZone(entityData.zone)
        }
        if (relData.ok) {
          setRelationships(relData.relationships || [])
        } else {
          setRelationships([])
        }
        setLastFetched(new Date())
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to fetch entity.")
      } finally {
        setLoading(false)
      }
    },
    [entityName]
  )

  useEffect(() => {
    void load(false)
  }, [load])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4 text-muted-foreground" />
              Data model registry
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Linked entity:{" "}
              <code className="font-mono">{entityName}</code>
              {zone && (
                <>
                  {" "}· zone{" "}
                  <code className="font-mono">{zone}</code>
                </>
              )}
              {entity?.version && (
                <>
                  {" "}· version{" "}
                  <code className="font-mono">{entity.version}</code>
                </>
              )}
              {lastFetched && (
                <>
                  {" "}· fetched{" "}
                  {lastFetched.toLocaleTimeString()}
                </>
              )}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(true)}
            disabled={loading}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`}
            />
            Resync
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !entity && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Fetching from registry...
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

        {entity && (
          <div className="space-y-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Attributes ({entity.attributes.length})
              </div>
              {entity.attributes.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No attributes returned by the registry.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="text-left p-2">Name</th>
                        <th className="text-left p-2">Type</th>
                        <th className="text-left p-2 w-[80px]">Nullable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entity.attributes.map((a) => (
                        <tr key={a.name} className="border-t">
                          <td className="p-2 font-mono">{a.name}</td>
                          <td className="p-2 text-muted-foreground">{a.type}</td>
                          <td className="p-2 text-muted-foreground">
                            {a.nullable === undefined
                              ? "—"
                              : a.nullable
                              ? "yes"
                              : "no"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Relationships ({relationships.length})
              </div>
              {relationships.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No relationships returned by the registry.
                </p>
              ) : (
                <ul className="text-xs space-y-1">
                  {relationships.map((r, i) => (
                    <li
                      key={`${r.parent}-${r.child}-${i}`}
                      className="font-mono"
                    >
                      {r.parent}{" "}
                      <span className="text-muted-foreground">
                        → {r.type || "→"} →
                      </span>{" "}
                      {r.child}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
