"use client"

// Form card — link this component to an entity in the external data
// model registry. Only rendered when the component type is `table`
// and the integration is enabled on the deployment (config is
// surfaced via a one-shot /api/healthcheck/data-model call).
//
// Persists as `data_model.entity` on the component YAML. There is no
// stored copy of the entity attributes — the detail page fetches
// them live so the registry stays the source of truth.

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Database, Unlink, Info } from "lucide-react"

interface Props {
  entity: string | undefined
  onChange: (entity: string | undefined) => void
}

export function DataModelLinkCard({ entity, onChange }: Props) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [zone, setZone] = useState<string | undefined>(undefined)
  const [missingEnv, setMissingEnv] = useState<string[]>([])
  const [draft, setDraft] = useState(entity || "")

  useEffect(() => {
    setDraft(entity || "")
  }, [entity])

  // One-shot probe so the form can show either the normal entity input
  // (when configured) or a discoverable instruction state (when not).
  // We never hide the card outright — the analyst should be able to
  // see that the feature exists and learn how to enable it.
  useEffect(() => {
    let cancelled = false
    fetch("/api/healthcheck/data-model", { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        setEnabled(!!data.configured)
        if (typeof data.zone === "string") setZone(data.zone)
        if (Array.isArray(data.missingEnv)) setMissingEnv(data.missingEnv)
      })
      .catch(() => {
        if (!cancelled) setEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (enabled === false) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            Data model registry link
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 space-y-2">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1 space-y-1">
                <p className="font-medium">
                  Integration is not configured on this deployment.
                </p>
                <p className="text-xs">
                  When the operator sets{" "}
                  <code className="font-mono">DATA_MODEL_REGISTRY_BASE_URL</code>{" "}
                  and credentials in <code className="font-mono">.env.local</code>,
                  this card will let you link the component to an entity in the
                  registry. Attributes and relationships are then fetched live on
                  the detail page — the catalog stores only the entity name and
                  never copies the registry data into YAML.
                </p>
                {missingEnv.length > 0 && (
                  <div className="text-xs mt-2">
                    <strong>Missing env vars:</strong>
                    <ul className="list-disc list-inside mt-1 space-y-0.5">
                      {missingEnv.map((v) => (
                        <li key={v}>
                          <code className="font-mono">{v}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-xs mt-2">
                  See <code className="font-mono">.env.local.example</code> for
                  the full list, or visit{" "}
                  <a href="/settings" className="underline">Settings → Health checks → Data model registry</a>{" "}
                  to verify the connection once env vars are in place.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (enabled === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            Data model registry link
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Checking integration status...
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          Data model registry link
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Optional. Link this <code>table</code> component to an entity in
          the external data model registry. The catalog stores only the
          entity name; attributes and relationships are fetched live on
          the detail page so the registry remains the source of truth.
          {zone && (
            <>
              {" "}Active zone:{" "}
              <code className="font-mono">{zone}</code>.
            </>
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="data-model-entity">Entity name</Label>
          <div className="flex items-center gap-2">
            <Input
              id="data-model-entity"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                const trimmed = e.target.value.trim()
                onChange(trimmed || undefined)
              }}
              placeholder="ENTITY_NAME"
              className="font-mono uppercase"
            />
            {draft && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraft("")
                  onChange(undefined)
                }}
                title="Remove the registry link"
              >
                <Unlink className="h-3.5 w-3.5 mr-1" />
                Unlink
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Case-sensitive identifier as the registry knows it. Saved as
            <code className="font-mono"> data_model.entity</code> on the
            component YAML.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
