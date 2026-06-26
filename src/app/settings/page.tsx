"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ArrowLeft,
  Loader2,
  Save,
  Check,
  X,
  Play,
  HeartPulse,
  FolderPlus,
  AlertTriangle,
  ListTree,
  ChevronRight,
} from "lucide-react"
import {
  BLOCK_METAS,
  type DetailTabId,
  type UIBlocksConfig,
} from "@/lib/ui-blocks"
import { useUIConfig } from "@/components/UIConfigProvider"
import { ApplicationSettings } from "@/components/ApplicationSettings"

type SettingsTab = "health" | "dsd" | "ui" | "app"
const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "health", label: "Health Checks" },
  { id: "dsd", label: "DSD Output" },
  { id: "ui", label: "UI Configuration" },
  { id: "app", label: "Application Settings" },
]

const TAB_LABELS: Record<DetailTabId, string> = {
  overview: "Overview",
  properties: "Properties",
  rules: "Rules & Calculations",
  "blast-radius": "Blast Radius",
  documentation: "Documentation",
  diagrams: "Diagrams",
  history: "History",
}

function blockKey(group: string, field: string): string {
  return `${group}.${field}`
}

function readVisible(
  blocks: UIBlocksConfig,
  group: string,
  field: string
): boolean {
  const groupCfg = (blocks as Record<string, Record<string, boolean | undefined> | undefined>)[
    group
  ]
  return groupCfg?.[field] !== false
}

type HealthKind = "llm" | "git" | "confluence" | "data-model" | "source-code" | "code-search"

interface ProbeStep {
  step: "dns" | "request" | "response" | "classify"
  ok: boolean
  ms?: number
  detail?: string
  // Optional phase label — set by multi-phase probes (e.g. OAuth token
  // endpoint vs gateway endpoint) so the UI can group steps.
  phase?: string
  // dns
  address?: string
  // request
  method?: string
  url?: string
  headers?: Record<string, string>
  // response
  status?: number
  statusText?: string
  bodyExcerpt?: string
  // classify
  category?: string
  hint?: string
}

interface ProbeTrace {
  ok: boolean
  totalMs: number
  steps: ProbeStep[]
}

interface DescribeAny {
  provider?: string
  edition?: string
  baseUrl?: string
  model?: string
  endpointTemplate?: string
  apiPathTemplate?: string
  authScheme?: string
  authHint?: string
  email?: string
  space?: { type: string; value: string }
  branch?: string
  repoIdentifier?: string
}

interface HealthResult {
  ok: boolean
  configured?: boolean
  elapsedMs?: number
  provider?: string
  edition?: string
  model?: string
  branch?: string
  describe?: DescribeAny
  trace?: ProbeTrace
  missingEnv?: string[]
  error?: string
  // Filesystem-specific: surfaced by /api/healthcheck/git when storage
  // root is missing its expected sub-directories.
  actions?: { canInitStorage?: boolean; missingSubdirs?: string[] }
}

interface HealthState {
  status: "idle" | "running" | "done"
  result?: HealthResult
  expanded?: boolean
}

const HEALTH_LABELS: Record<HealthKind, string> = {
  llm: "LLM",
  git: "Git backend",
  confluence: "Confluence",
  "data-model": "Data model registry",
  "source-code": "Source code (ADO)",
  "code-search": "Code Search (ADO)",
}

export default function SettingsPage() {
  const { blocks, loaded, refresh } = useUIConfig()
  const [tab, setTab] = useState<SettingsTab>("health")
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [health, setHealth] = useState<Record<HealthKind, HealthState>>({
    llm: { status: "idle" },
    git: { status: "idle" },
    confluence: { status: "idle" },
    "data-model": { status: "idle" },
    "source-code": { status: "idle" },
    "code-search": { status: "idle" },
  })

  // Hydrate local state from the loaded config once.
  useEffect(() => {
    if (!loaded) return
    const next: Record<string, boolean> = {}
    for (const b of BLOCK_METAS) {
      next[blockKey(b.group as string, b.field)] = readVisible(
        blocks,
        b.group as string,
        b.field
      )
    }
    setVisible(next)
  }, [loaded, blocks])

  const groupedByTab = BLOCK_METAS.reduce((acc, b) => {
    if (!acc[b.tab]) acc[b.tab] = []
    acc[b.tab].push(b)
    return acc
  }, {} as Record<DetailTabId, typeof BLOCK_METAS>)

  function toggle(group: string, field: string) {
    setVisible((prev) => ({ ...prev, [blockKey(group, field)]: !prev[blockKey(group, field)] }))
  }

  function setAll(value: boolean) {
    const next: Record<string, boolean> = {}
    for (const b of BLOCK_METAS) {
      next[blockKey(b.group as string, b.field)] = value
    }
    setVisible(next)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSavedAt(null)

    // Build nested UIBlocksConfig from the flat checkbox map.
    const blocksOut: UIBlocksConfig = {}
    for (const b of BLOCK_METAS) {
      const v = visible[blockKey(b.group as string, b.field)]
      // Persist only the explicit false values to keep YAML small;
      // missing keys default to visible.
      if (v === false) {
        const groupKey = b.group as keyof UIBlocksConfig
        const group =
          (blocksOut[groupKey] as Record<string, boolean> | undefined) || {}
        group[b.field] = false
        ;(blocksOut as Record<string, Record<string, boolean>>)[
          groupKey as string
        ] = group
      }
    }

    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks: blocksOut }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }))
        throw new Error(body.error || `Save failed: ${res.status}`)
      }
      await refresh()
      setSavedAt(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  async function runHealth(kind: HealthKind) {
    setHealth((prev) => ({
      ...prev,
      [kind]: { status: "running", expanded: prev[kind].expanded },
    }))
    try {
      const res = await fetch(`/api/healthcheck/${kind}`, { method: "POST" })
      const data = (await res.json()) as HealthResult
      setHealth((prev) => ({
        ...prev,
        [kind]: {
          status: "done",
          result: data,
          // Auto-expand on failure so the user immediately sees the
          // describe + trace; collapsed by default on success.
          expanded: !data.ok || prev[kind].expanded,
        },
      }))
    } catch (e) {
      setHealth((prev) => ({
        ...prev,
        [kind]: {
          status: "done",
          result: { ok: false, error: e instanceof Error ? e.message : "Request failed" },
          expanded: true,
        },
      }))
    }
  }

  function runAllHealth() {
    void runHealth("llm")
    void runHealth("git")
    void runHealth("confluence")
    void runHealth("data-model")
    void runHealth("source-code")
    void runHealth("code-search")
  }

  function toggleExpand(kind: HealthKind) {
    setHealth((prev) => ({
      ...prev,
      [kind]: { ...prev[kind], expanded: !prev[kind].expanded },
    }))
  }

  if (!loaded) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
        Loading settings...
      </div>
    )
  }

  const tabsInOrder: DetailTabId[] = [
    "overview",
    "properties",
    "rules",
    "blast-radius",
    "documentation",
    "diagrams",
    "history",
  ]

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connection health, the DSD output structure, what the component detail page shows, and the application configuration.
          </p>
        </div>
      </div>

      {/* Tab nav */}
      <div className="border-b">
        <nav className="-mb-px flex gap-1 flex-wrap" role="tablist">
          {SETTINGS_TABS.map((t) => (
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

      {tab === "app" && <ApplicationSettings />}

      {tab === "dsd" && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListTree className="h-4 w-4 text-muted-foreground" />
            DSD Output
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Link
            href="/dsd-structure"
            className="flex items-center gap-3 rounded-md border p-3 hover:bg-muted/40 transition-colors"
          >
            <ListTree className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-medium">Edit the DSD output structure</div>
              <div className="text-xs text-muted-foreground">
                Chapters, titles and guidance the generated DSD must contain — add, remove, reorder or move chapters between writers.
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
          </Link>
        </CardContent>
      </Card>
      )}

      {tab === "health" && (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <HeartPulse className="h-4 w-4 text-muted-foreground" />
              Health checks
            </CardTitle>
            <Button variant="outline" size="sm" onClick={runAllHealth}>
              <Play className="h-3.5 w-3.5 mr-1" />
              Run all
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {(["llm", "git", "confluence", "data-model", "source-code", "code-search"] as HealthKind[]).map((kind) => {
            const s = health[kind]
            const r = s.result
            const failingCategory = r?.trace?.steps
              .filter((st) => st.step === "classify")
              .map((st) => st.category)[0]
            return (
              <div
                key={kind}
                className="py-2 border-b last:border-b-0"
              >
                <div className="flex items-center gap-3">
                  <div className="w-32 text-sm font-medium">
                    {HEALTH_LABELS[kind]}
                  </div>
                  <div className="flex-1 text-xs text-muted-foreground">
                    {s.status === "running" ? (
                      <span className="inline-flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Probing...
                      </span>
                    ) : s.status === "idle" || !r ? (
                      <span className="opacity-60">Not tested yet</span>
                    ) : r.ok ? (
                      <span className="inline-flex items-center gap-2 text-green-700">
                        <Check className="h-3.5 w-3.5" />
                        <span>
                          OK
                          {r.elapsedMs !== undefined ? ` · ${r.elapsedMs}ms` : ""}
                          {r.provider ? ` · ${r.provider}` : ""}
                          {r.edition ? ` · ${r.edition}` : ""}
                          {r.model ? ` · ${r.model}` : ""}
                          {r.branch ? ` · ${r.branch}` : ""}
                        </span>
                      </span>
                    ) : (
                      <span className="inline-flex items-start gap-2 text-destructive">
                        <X className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span className="break-all">
                          {failingCategory ? (
                            <code className="font-mono bg-destructive/10 px-1 rounded mr-1">{failingCategory}</code>
                          ) : null}
                          {r.error || `Failed${r.elapsedMs !== undefined ? ` · ${r.elapsedMs}ms` : ""}`}
                        </span>
                      </span>
                    )}
                  </div>
                  {r && (r.describe || r.trace || r.missingEnv) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs"
                      onClick={() => toggleExpand(kind)}
                    >
                      {s.expanded ? "Hide detail" : "Show detail"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runHealth(kind)}
                    disabled={s.status === "running"}
                  >
                    Test
                  </Button>
                </div>

                {s.expanded && r && (
                  <div className="mt-3 ml-32 space-y-3 text-xs">
                    {r.missingEnv && r.missingEnv.length > 0 && (
                      <div className="rounded-md border border-orange-200 bg-orange-50 p-3 text-orange-900">
                        <div className="font-medium mb-1">Missing environment variables</div>
                        <ul className="list-disc list-inside space-y-0.5">
                          {r.missingEnv.map((v) => (
                            <li key={v}><code className="font-mono">{v}</code></li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {r.actions?.canInitStorage && (
                      <InitStorageBlock
                        missingSubdirs={r.actions.missingSubdirs || []}
                        onInitialised={() => runHealth(kind)}
                      />
                    )}

                    {r.describe && <DescribeBlock describe={r.describe} />}
                    {r.trace && <TraceBlock trace={r.trace} />}
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>
      )}

      {tab === "ui" && (
      <>
      <p className="text-sm text-muted-foreground">
        Hide blocks on the component detail page. Applies to every component for everyone in the team. Saved in <code className="font-mono text-xs">config.yaml</code> in the data repo.
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setAll(true)}>
          Show all
        </Button>
        <Button variant="outline" size="sm" onClick={() => setAll(false)}>
          Hide all
        </Button>
      </div>

      {tabsInOrder.map((tabId) => {
        const blocksInTab = groupedByTab[tabId] || []
        if (blocksInTab.length === 0) return null
        return (
          <Card key={tabId}>
            <CardHeader>
              <CardTitle className="text-base">{TAB_LABELS[tabId]} tab</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {blocksInTab.map((b) => {
                const k = blockKey(b.group as string, b.field)
                const checked = visible[k] ?? true
                return (
                  <label
                    key={k}
                    className="flex items-start gap-3 cursor-pointer select-none rounded-md p-2 hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(b.group as string, b.field)}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{b.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {b.description}
                      </div>
                    </div>
                  </label>
                )
              })}
            </CardContent>
          </Card>
        )
      })}

      <div className="flex items-center gap-3 sticky bottom-0 bg-background/95 backdrop-blur border-t py-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save
            </>
          )}
        </Button>
        {savedAt && (
          <span className="text-sm text-green-700 flex items-center gap-1">
            <Check className="h-4 w-4" />
            Saved
          </span>
        )}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
      </>
      )}
    </div>
  )
}

// --- helper components for the verbose health-check detail view ---------

function DescribeBlock({ describe }: { describe: DescribeAny }) {
  const rows: Array<[string, string | undefined]> = []
  if (describe.provider) rows.push(["Provider", describe.provider])
  if (describe.edition) rows.push(["Edition", describe.edition])
  if (describe.baseUrl) rows.push(["Base URL", describe.baseUrl])
  if (describe.endpointTemplate)
    rows.push(["Endpoint", describe.endpointTemplate])
  if (describe.apiPathTemplate)
    rows.push(["API path", describe.apiPathTemplate])
  if (describe.repoIdentifier) rows.push(["Repo", describe.repoIdentifier])
  if (describe.branch) rows.push(["Branch", describe.branch])
  if (describe.model) rows.push(["Model", describe.model])
  if (describe.space)
    rows.push([`Space (${describe.space.type})`, describe.space.value])
  if (describe.email) rows.push(["Email", describe.email])
  if (describe.authScheme) rows.push(["Auth scheme", describe.authScheme])
  if (describe.authHint) rows.push(["Credential", describe.authHint])

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-1">
      <div className="font-medium text-foreground mb-1">Connection</div>
      <table className="w-full">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-border/50 last:border-b-0">
              <td className="py-1 pr-3 text-muted-foreground align-top whitespace-nowrap">
                {k}
              </td>
              <td className="py-1 font-mono break-all">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TraceBlock({ trace }: { trace: ProbeTrace }) {
  let lastPhase: string | undefined
  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <div className="font-medium text-foreground">
        Probe trace
        <span className="ml-2 text-muted-foreground font-normal">
          · total {trace.totalMs}ms
        </span>
      </div>
      {trace.steps.map((s, i) => {
        const showPhase = s.phase && s.phase !== lastPhase
        const node = (
          <div key={i}>
            {showPhase && (
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mt-2 mb-1">
                Phase: {s.phase}
              </div>
            )}
            <TraceStepLine step={s} />
          </div>
        )
        if (s.phase) lastPhase = s.phase
        return node
      })}
    </div>
  )
}

function TraceStepLine({ step }: { step: ProbeStep }) {
  const icon = step.ok ? (
    <span className="text-green-700">✓</span>
  ) : (
    <span className="text-destructive">✗</span>
  )
  return (
    <div className="border-l-2 border-border pl-3 space-y-0.5">
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-medium capitalize">{step.step}</span>
        {step.ms !== undefined && (
          <span className="text-muted-foreground">{step.ms}ms</span>
        )}
        {step.method && step.url && (
          <span className="text-muted-foreground">
            · {step.method} {step.url}
          </span>
        )}
        {step.status !== undefined && (
          <span className="text-muted-foreground">
            · {step.status} {step.statusText}
          </span>
        )}
        {step.address && (
          <span className="text-muted-foreground">· {step.address}</span>
        )}
        {step.category && (
          <code className="text-xs px-1 rounded bg-destructive/10 text-destructive font-mono">
            {step.category}
          </code>
        )}
      </div>
      {step.headers && (
        <details className="ml-5 mt-1">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Headers ({Object.keys(step.headers).length})
          </summary>
          <pre className="font-mono text-[11px] mt-1 p-2 rounded bg-background border overflow-x-auto">
            {Object.entries(step.headers)
              .map(([k, v]) => `${k}: ${v}`)
              .join("\n")}
          </pre>
        </details>
      )}
      {step.bodyExcerpt && (
        <details className="ml-5 mt-1" open={!step.ok}>
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Response body ({step.bodyExcerpt.length} chars)
          </summary>
          <pre className="font-mono text-[11px] mt-1 p-2 rounded bg-background border overflow-x-auto whitespace-pre-wrap break-all">
            {step.bodyExcerpt}
          </pre>
        </details>
      )}
      {step.detail && !step.headers && !step.bodyExcerpt && (
        <div className="ml-5 text-muted-foreground">{step.detail}</div>
      )}
      {step.hint && (
        <div className="ml-5 mt-1 text-foreground/80 italic">{step.hint}</div>
      )}
    </div>
  )
}

function InitStorageBlock({
  missingSubdirs,
  onInitialised,
}: {
  missingSubdirs: string[]
  onInitialised: () => void
}) {
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function initialise() {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch("/api/init-storage", { method: "POST" })
      const data = (await res.json()) as {
        ok: boolean
        created?: string[]
        error?: string
        message?: string
      }
      if (!data.ok) {
        setError(data.message || data.error || "Failed to initialise storage.")
        return
      }
      setDone(true)
      onInitialised()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to initialise storage.")
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="rounded-md border border-orange-200 bg-orange-50 p-3 text-orange-900 space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="font-medium mb-1">Storage not initialised</div>
          <div className="text-xs">
            The storage root is reachable but missing the required
            sub-directories. Click below to create them in one step.
          </div>
          <ul className="list-disc list-inside text-xs mt-1 space-y-0.5">
            {missingSubdirs.map((d) => (
              <li key={d}><code className="font-mono">{d}/</code></li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={initialise}
          disabled={running || done}
        >
          {running ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              Initialising...
            </>
          ) : done ? (
            <>
              <Check className="h-3.5 w-3.5 mr-1" />
              Initialised
            </>
          ) : (
            <>
              <FolderPlus className="h-3.5 w-3.5 mr-1" />
              Initialize storage
            </>
          )}
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  )
}
