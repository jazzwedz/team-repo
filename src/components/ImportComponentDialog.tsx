"use client"

// Import wizard for pasting / uploading component YAML.
//
// Accepts either a single component or a multi-doc bundle (`---`
// separated) — the same shape produced by the catalog YAML export.
//
// Workflow:
//   1. User pastes YAML or uploads a .yaml file.
//   2. "On id conflict" picks what happens when an incoming id already
//      exists: Update existing (default) / Create copy / Skip.
//   3. Optional "Validate" runs the same validator the server uses
//      (validateComponentDocs) and surfaces per-document errors +
//      warnings so the user can fix the YAML before submitting.
//   4. "Import" POSTs to /api/components/import. A single applied
//      component redirects to its edit page; a bundle shows a summary
//      report (created / updated / renamed / skipped / errors).

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Upload, AlertCircle, CheckCircle2, Info, FileUp } from "lucide-react"
import {
  validateComponentDocs,
  loadYamlDocs,
  type ValidationIssue,
} from "@/lib/component-schema"

type ConflictMode = "update" | "merge" | "create" | "skip"

const CONFLICT_OPTIONS: { value: ConflictMode; label: string; hint: string }[] = [
  { value: "update", label: "Update existing", hint: "Overwrite a component with the same id." },
  {
    value: "merge",
    label: "Merge fields",
    hint: "Partial import — patch only the fields you provide onto an existing component (by id); the rest stay as they are.",
  },
  { value: "create", label: "Create copy", hint: "Keep both — append -2 to the incoming id." },
  { value: "skip", label: "Skip existing", hint: "Leave components with a matching id untouched." },
]

interface DocPreview {
  ok: boolean
  name?: string
  id?: string
  type?: string
  /** Merge mode: the top-level fields this patch will override. */
  patchFields?: string[]
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

interface CheckState {
  status: "idle" | "checked"
  docs: DocPreview[]
}

interface ImportResultRow {
  index: number
  id: string
  finalId?: string
  name?: string
  action: "created" | "updated" | "merged" | "renamed" | "skipped" | "error"
  fields?: string[]
  error?: string
}

interface ImportSummary {
  total: number
  created: number
  updated: number
  merged: number
  renamed: number
  skipped: number
  errors: number
}

const EMPTY: CheckState = { status: "idle", docs: [] }

export function ImportComponentDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [yamlText, setYamlText] = useState("")
  const [onConflict, setOnConflict] = useState<ConflictMode>("update")
  const [check, setCheck] = useState<CheckState>(EMPTY)
  const [importing, setImporting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [report, setReport] = useState<{ rows: ImportResultRow[]; summary: ImportSummary } | null>(
    null
  )
  const fileInputRef = useRef<HTMLInputElement>(null)

  function resetAndClose() {
    setOpen(false)
    // Defer reset so the closing animation doesn't show a flash of cleared state.
    setTimeout(() => {
      setYamlText("")
      setOnConflict("update")
      setCheck(EMPTY)
      setServerError(null)
      setReport(null)
      setImporting(false)
    }, 200)
  }

  function clearDerived() {
    if (check.status !== "idle") setCheck(EMPTY)
    if (serverError) setServerError(null)
    if (report) setReport(null)
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setYamlText(text)
    clearDerived()
    // Reset the input so picking the same file again re-fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function runValidate() {
    setServerError(null)
    setReport(null)
    if (yamlText.trim() === "") {
      setCheck({
        status: "checked",
        docs: [{ ok: false, errors: [{ path: "", message: "Paste or upload some YAML first." }], warnings: [] }],
      })
      return
    }

    // Merge mode patches are partial (often no `name`), so the full
    // component validator does not apply — we only check that each doc
    // is an object with an id and surface the fields it will override.
    // The authoritative validation runs server-side on the MERGED object.
    if (onConflict === "merge") {
      const loaded = loadYamlDocs(yamlText)
      if (!loaded.ok) {
        setCheck({ status: "checked", docs: [{ ok: false, errors: [{ path: "", message: loaded.error }], warnings: [] }] })
        return
      }
      const docs: DocPreview[] = loaded.docs.map((d) => {
        if (typeof d !== "object" || d === null || Array.isArray(d)) {
          return { ok: false, errors: [{ path: "", message: "Document must be a YAML object." }], warnings: [] }
        }
        const obj = d as Record<string, unknown>
        const id = typeof obj.id === "string" ? obj.id.trim() : ""
        if (!id) {
          return { ok: false, errors: [{ path: "id", message: "Merge requires an `id` matching an existing component." }], warnings: [] }
        }
        const patchFields = Object.keys(obj).filter((k) => k !== "id" && k !== "schema_version")
        if (patchFields.length === 0) {
          return { ok: false, id, errors: [{ path: "", message: "No fields to merge (only `id` provided)." }], warnings: [] }
        }
        return { ok: true, id, patchFields, errors: [], warnings: [] }
      })
      setCheck({ status: "checked", docs })
      return
    }

    const results = validateComponentDocs(yamlText)
    const docs: DocPreview[] = results.map((r) =>
      r.ok
        ? { ok: true, name: r.value.name, id: r.value.id, type: r.value.type, errors: [], warnings: r.warnings }
        : { ok: false, errors: r.errors, warnings: r.warnings }
    )
    setCheck({ status: "checked", docs })
  }

  async function runImport() {
    setServerError(null)
    setReport(null)
    setImporting(true)
    try {
      const r = await fetch("/api/components/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml: yamlText, onConflict }),
      })
      const data = (await r.json().catch(() => null)) as
        | {
            success?: boolean
            id?: string
            error?: string
            issues?: ValidationIssue[]
            warnings?: ValidationIssue[]
            results?: ImportResultRow[]
            summary?: ImportSummary
          }
        | null

      if (!r.ok) {
        if (data?.issues && Array.isArray(data.issues)) {
          // Server-side validation rejection — show the server's view.
          setCheck({
            status: "checked",
            docs: [{ ok: false, errors: data.issues, warnings: data.warnings ?? [] }],
          })
        }
        setServerError(data?.error || `Import failed (${r.status})`)
        return
      }

      // Single applied component → jump straight to its edit page.
      if (data?.success && typeof data.id === "string") {
        router.push(`/edit/${encodeURIComponent(data.id)}`)
        resetAndClose()
        return
      }

      // Bundle → show the report and let the user return to the catalog.
      if (data?.results && data?.summary) {
        setReport({ rows: data.results, summary: data.summary })
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Import failed")
    } finally {
      setImporting(false)
    }
  }

  const validCount = check.docs.filter((d) => d.ok).length
  const errorCount = check.docs.filter((d) => !d.ok).length

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : resetAndClose())}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="h-4 w-4 mr-2" />
          Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Import components</DialogTitle>
          <DialogDescription>
            Paste or upload a single component or a multi-document bundle
            (<code>---</code> separated, the catalog YAML export format). On id
            conflict the default is to <strong>update</strong> the existing
            component; <strong>Merge fields</strong> does a partial import —
            it patches only the fields you provide (e.g. just <code>nfr</code>)
            onto an existing component by <code>id</code>, leaving the rest
            untouched. See{" "}
            <a href="/architecture.html" className="underline" target="_blank" rel="noreferrer">
              the model sheet
            </a>{" "}
            for the schema.
          </DialogDescription>
        </DialogHeader>

        {!report && (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              {/* Conflict mode */}
              <div className="flex items-center gap-3 flex-wrap text-sm">
                <span className="text-muted-foreground">On id conflict:</span>
                <div className="flex gap-1 rounded-md border p-0.5">
                  {CONFLICT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      title={opt.hint}
                      onClick={() => {
                        setOnConflict(opt.value)
                        // Preview differs between merge and full modes.
                        clearDerived()
                      }}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                        onConflict === opt.value
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* File upload */}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".yaml,.yml,text/yaml,application/x-yaml"
                  onChange={onFilePicked}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                >
                  <FileUp className="h-3.5 w-3.5 mr-1.5" />
                  Upload .yaml
                </Button>
              </div>
            </div>

            <textarea
              value={yamlText}
              onChange={(e) => {
                setYamlText(e.target.value)
                clearDerived()
              }}
              placeholder={`name: Order Service\ntype: service\nowner: payments-team\ndescription:\n  description: |\n    Handles the order lifecycle from cart to fulfilment.\n---\nname: Payment Gateway\ntype: service\n`}
              spellCheck={false}
              className="font-mono text-xs min-h-[280px] w-full rounded-md border border-input bg-background px-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />

            {check.status === "checked" && (
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">
                  <strong>{check.docs.length}</strong> document
                  {check.docs.length === 1 ? "" : "s"} · {validCount} valid
                  {errorCount > 0 && (
                    <>
                      {" "}
                      · <span className="text-red-700 font-medium">{errorCount} with errors</span>
                    </>
                  )}
                </div>
                <div className="space-y-2 max-h-64 overflow-auto">
                  {check.docs.map((d, i) => (
                    <DocCard key={i} index={i} doc={d} />
                  ))}
                </div>
              </div>
            )}

            {serverError && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>{serverError}</div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={runValidate} disabled={importing}>
                Validate
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={resetAndClose} disabled={importing}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={runImport}
                  disabled={importing || yamlText.trim() === "" || (check.status === "checked" && validCount === 0)}
                >
                  {importing ? "Importing…" : "Import"}
                </Button>
              </div>
            </div>
          </>
        )}

        {report && (
          <div className="space-y-3">
            <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-green-900">
                <CheckCircle2 className="h-4 w-4" />
                Import finished
              </div>
              <div className="text-green-900 pl-6 mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                <span>created: {report.summary.created}</span>
                <span>updated: {report.summary.updated}</span>
                <span>merged: {report.summary.merged}</span>
                <span>copied: {report.summary.renamed}</span>
                <span>skipped: {report.summary.skipped}</span>
                {report.summary.errors > 0 && (
                  <span className="text-red-700 font-medium">errors: {report.summary.errors}</span>
                )}
              </div>
            </div>

            <div className="space-y-1 max-h-72 overflow-auto">
              {report.rows.map((row, i) => (
                <ResultRow key={i} row={row} />
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setReport(null)
                  setCheck(EMPTY)
                }}
              >
                Import more
              </Button>
              <Button
                type="button"
                onClick={() => {
                  resetAndClose()
                  router.push("/")
                  router.refresh()
                }}
              >
                Go to catalog
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DocCard({ index, doc }: { index: number; doc: DocPreview }) {
  if (doc.ok) {
    // Merge-mode preview: show the id being patched and which fields.
    if (doc.patchFields) {
      return (
        <div className="rounded-md border border-blue-300 bg-blue-50 p-2.5 text-sm">
          <div className="flex items-center gap-2 text-blue-900 flex-wrap">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span className="font-medium">Patch</span>
            <code className="text-xs text-blue-700">{doc.id}</code>
            <span className="text-xs text-blue-700">
              · fields: {doc.patchFields.join(", ")}
            </span>
          </div>
        </div>
      )
    }
    return (
      <div className="rounded-md border border-green-300 bg-green-50 p-2.5 text-sm">
        <div className="flex items-center gap-2 text-green-900">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span className="font-medium">{doc.name}</span>
          <code className="text-xs text-green-700">{doc.id}</code>
          <span className="text-xs text-green-700">· {doc.type}</span>
        </div>
        {doc.warnings.length > 0 && <IssueList kind="warning" items={doc.warnings} />}
      </div>
    )
  }
  return (
    <div className="rounded-md border border-red-300 bg-red-50 p-2.5 text-sm">
      <div className="flex items-center gap-2 font-medium text-red-900">
        <AlertCircle className="h-4 w-4 shrink-0" />
        Document {index + 1} — invalid
      </div>
      <IssueList kind="error" items={doc.errors} />
      {doc.warnings.length > 0 && <IssueList kind="warning" items={doc.warnings} />}
    </div>
  )
}

function ResultRow({ row }: { row: ImportResultRow }) {
  const tone: Record<ImportResultRow["action"], string> = {
    created: "text-green-700",
    updated: "text-blue-700",
    merged: "text-blue-700",
    renamed: "text-amber-700",
    skipped: "text-muted-foreground",
    error: "text-red-700",
  }
  return (
    <div className="flex items-center gap-2 text-sm border-b last:border-b-0 py-1">
      <span className={`w-16 shrink-0 font-medium ${tone[row.action]}`}>{row.action}</span>
      <code className="text-xs">{row.finalId || row.id || `#${row.index + 1}`}</code>
      {row.name && <span className="text-muted-foreground truncate">— {row.name}</span>}
      {row.action === "merged" && row.fields && row.fields.length > 0 && (
        <span className="text-blue-700 text-xs truncate">· {row.fields.join(", ")}</span>
      )}
      {row.error && <span className="text-red-700 text-xs truncate">· {row.error}</span>}
    </div>
  )
}

function IssueList({ kind, items }: { kind: "error" | "warning"; items: ValidationIssue[] }) {
  const tone =
    kind === "error"
      ? "border-red-300 bg-red-50 text-red-900"
      : "border-amber-300 bg-amber-50 text-amber-900"
  const Icon = kind === "error" ? AlertCircle : Info
  const label = kind === "error" ? "Errors" : "Warnings"
  return (
    <div className={`rounded-md border p-2 text-xs space-y-1 mt-1.5 ${tone}`}>
      <div className="flex items-center gap-2 font-medium">
        <Icon className="h-3.5 w-3.5" />
        {label} ({items.length})
      </div>
      <ul className="pl-5 list-disc space-y-0.5">
        {items.map((it, i) => (
          <li key={i}>
            {it.path && (
              <>
                <code className="font-mono">{it.path}</code> —{" "}
              </>
            )}
            {it.message}
          </li>
        ))}
      </ul>
    </div>
  )
}
