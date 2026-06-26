"use client"

// Application Settings — edit everything that used to live only in
// .env.local. Effective value is "saved in UI ?? environment", so existing
// .env.local values keep working until overridden here. Secrets are masked
// and follow a "leave blank = keep current" model; raw secret values are
// never sent to the browser.

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, Save, AlertCircle, RotateCcw, Lock } from "lucide-react"

interface EffectiveField {
  key: string
  group: string
  label: string
  type: "text" | "password" | "select"
  secret: boolean
  envOnly: boolean
  options?: string[]
  placeholder?: string
  help?: string
  source: "ui" | "env" | "unset"
  hasValue: boolean
  value: string
}

export function ApplicationSettings() {
  const [groups, setGroups] = useState<string[]>([])
  const [fields, setFields] = useState<EffectiveField[]>([])
  const [edited, setEdited] = useState<Record<string, string>>({})
  const [cleared, setCleared] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch("/api/app-config")
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || `Failed (${r.status})`)
      setGroups(d.groups || [])
      setFields(d.fields || [])
      setEdited({})
      setCleared(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  const byGroup = useMemo(() => {
    const m = new Map<string, EffectiveField[]>()
    for (const f of fields) {
      if (!m.has(f.group)) m.set(f.group, [])
      m.get(f.group)!.push(f)
    }
    return m
  }, [fields])

  const dirty = Object.keys(edited).length > 0 || cleared.size > 0

  function setVal(key: string, val: string) {
    setEdited((p) => ({ ...p, [key]: val }))
    setCleared((p) => {
      if (!p.has(key)) return p
      const n = new Set(p)
      n.delete(key)
      return n
    })
    setSavedMsg(null)
  }
  function clearKey(key: string) {
    setCleared((p) => new Set(p).add(key))
    setEdited((p) => {
      const n = { ...p }
      delete n[key]
      return n
    })
    setSavedMsg(null)
  }
  function undoClear(key: string) {
    setCleared((p) => {
      const n = new Set(p)
      n.delete(key)
      return n
    })
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const r = await fetch("/api/app-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: edited, clear: Array.from(cleared) }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || `Save failed (${r.status})`)
      setGroups(d.groups || [])
      setFields(d.fields || [])
      setEdited({})
      setCleared(new Set())
      setSavedMsg("Saved. Most changes apply immediately; a couple (e.g. public URL) need a restart.")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  function SourceBadge({ f }: { f: EffectiveField }) {
    if (cleared.has(f.key)) return <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">will clear</Badge>
    if (edited[f.key] !== undefined) return <Badge variant="outline" className="text-[10px] text-blue-700 border-blue-300">edited</Badge>
    if (f.source === "ui") return <Badge variant="outline" className="text-[10px] text-green-700 border-green-300">saved</Badge>
    if (f.source === "env") return <Badge variant="outline" className="text-[10px] text-muted-foreground">from .env</Badge>
    return <Badge variant="outline" className="text-[10px] text-muted-foreground opacity-60">not set</Badge>
  }

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 flex items-start gap-2">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          Effective value is <strong>what you save here, otherwise your environment</strong> (<code>.env.local</code>). Saved values are
          stored in a local, gitignored file — never committed. Secrets are masked; <strong>leave a secret blank to keep the current value</strong>,
          or use <em>Clear</em> to remove an override.
        </span>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}
      {savedMsg && !dirty && (
        <div className="rounded-md border border-green-300 bg-green-50 p-2.5 text-sm text-green-900">{savedMsg}</div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading settings…
        </div>
      )}

      {!loading &&
        groups.map((group) => {
          const gf = byGroup.get(group) || []
          if (gf.length === 0) return null
          return (
            <Card key={group}>
              <CardContent className="pt-4 space-y-3">
                <h3 className="text-sm font-semibold">{group}</h3>
                {gf.map((f) => {
                  const isCleared = cleared.has(f.key)
                  const editedVal = edited[f.key]
                  const shownValue = editedVal !== undefined ? editedVal : f.secret ? "" : isCleared ? "" : f.value
                  const secretPlaceholder =
                    f.secret && f.hasValue && !isCleared && editedVal === undefined
                      ? "•••••••• (saved — leave blank to keep)"
                      : f.placeholder || ""
                  return (
                    <div key={f.key} className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-2 sm:gap-3 items-start">
                      <div className="pt-2">
                        <div className="text-sm font-medium flex items-center gap-1.5">
                          {f.label}
                          {f.envOnly && <Lock className="h-3 w-3 text-muted-foreground" />}
                        </div>
                        <code className="text-[10px] text-muted-foreground break-all">{f.key}</code>
                      </div>
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {f.envOnly ? (
                            <Input value={f.hasValue ? "•••••••• (set via environment)" : "(not set)"} disabled className="bg-muted/40" />
                          ) : f.type === "select" ? (
                            <select
                              className="h-9 flex-1 rounded-md border bg-background px-2 text-sm"
                              value={isCleared ? "" : shownValue}
                              onChange={(e) => setVal(f.key, e.target.value)}
                            >
                              <option value="">(default)</option>
                              {(f.options || []).map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <Input
                              type={f.type === "password" ? "password" : "text"}
                              value={shownValue}
                              placeholder={secretPlaceholder}
                              autoComplete="off"
                              onChange={(e) => setVal(f.key, e.target.value)}
                            />
                          )}
                          <SourceBadge f={f} />
                          {!f.envOnly && (f.source === "ui" || isCleared) && (
                            isCleared ? (
                              <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => undoClear(f.key)}>
                                <RotateCcw className="h-3.5 w-3.5 mr-1" /> undo
                              </Button>
                            ) : (
                              <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-red-600" onClick={() => clearKey(f.key)}>
                                Clear
                              </Button>
                            )
                          )}
                        </div>
                        {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          )
        })}

      {!loading && (
        <div className="flex items-center gap-3 sticky bottom-0 bg-background/95 backdrop-blur border-t py-4">
          <Button onClick={save} disabled={!dirty || saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save application settings
          </Button>
          {dirty && <span className="text-xs text-muted-foreground">{Object.keys(edited).length} edited · {cleared.size} to clear</span>}
        </div>
      )}
    </div>
  )
}
