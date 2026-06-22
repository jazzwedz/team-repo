"use client"

// Rules-import dialog — three-step wizard:
//   1. source        analyst picks a PDF or pastes a Confluence URL
//   2. analyzing     server runs Pass 1 (relevance filter, when doc is
//                    large) + Pass 2 (extract structured candidates)
//   3. review        analyst checks/edits/imports candidates
//
// Step 2 has no manual UI — the relevance filter runs internally and
// the user only sees a progress strip while it does. Save is delegated
// to the parent via `onImport(candidates)` so this dialog never knows
// about the component-update API.

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Upload,
  FileText,
  Globe,
  Loader2,
  AlertTriangle,
  Check,
  Sparkles,
  X,
  Code as CodeIcon,
} from "lucide-react"
import { RULE_KINDS, RULE_KIND_LABELS } from "@/lib/constants"
import { AgentRunModal } from "@/components/AgentRunModal"
import type { ComponentRule, RuleKind } from "@/lib/types"

type Step = "source" | "analyzing" | "review" | "error"
type SourceKind = "pdf" | "confluence" | "code"

const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "java", label: "Java" },
  { value: "kotlin", label: "Kotlin" },
  { value: "csharp", label: "C#" },
  { value: "python", label: "Python" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "ruby", label: "Ruby" },
  { value: "php", label: "PHP" },
  { value: "swift", label: "Swift" },
  { value: "cpp", label: "C++" },
  { value: "c", label: "C" },
  { value: "sql", label: "SQL" },
  { value: "plsql", label: "PL/SQL" },
  { value: "cobol", label: "COBOL" },
  { value: "scala", label: "Scala" },
  { value: "groovy", label: "Groovy" },
]

interface Candidate {
  name: string
  kind: RuleKind
  summary?: string
  description?: string
  formula?: string
  given?: string
  when?: string
  then?: string
  enforced_in?: string
  confidence: "high" | "medium" | "low"
  evidence?: string
  sourceSection?: string
  duplicate_of_index?: number | null
}

interface ImportMeta {
  docName: string
  docChars: number
  pass1Skipped: boolean
  relevantSectionsCount: number
  candidatesCount: number
  totalMs: number
}

interface ApiSuccess {
  ok: true
  candidates: Candidate[]
  meta: ImportMeta
}

interface ApiError {
  ok: false
  error: string
  message: string
  docChars?: number
  maxChars?: number
}

type ApiResponse = ApiSuccess | ApiError

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  componentId: string
  componentName: string
  existingRules: ComponentRule[]
  // Returns a string error message on failure, void on success.
  onImport: (newRules: ComponentRule[]) => Promise<string | void>
}

// Phases for the progress strip in step 2. We do not actually drive
// these from the server (the API is one round trip), but a moving label
// makes the wait feel less opaque on slow corp networks.
const PHASE_LABELS = [
  "Reading source...",
  "Identifying relevant sections...",
  "Extracting rule candidates...",
]

export function RulesImportDialog({
  open,
  onOpenChange,
  componentId,
  componentName,
  existingRules,
  onImport,
}: Props) {
  const [step, setStep] = useState<Step>("source")
  const [sourceKind, setSourceKind] = useState<SourceKind>("pdf")
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [confluenceUrl, setConfluenceUrl] = useState("")
  const [codeText, setCodeText] = useState("")
  const [codeLanguage, setCodeLanguage] = useState("auto")
  const [codeFilename, setCodeFilename] = useState<string | undefined>(undefined)
  const [phaseIdx, setPhaseIdx] = useState(0)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [selected, setSelected] = useState<Record<number, boolean>>({})
  const [meta, setMeta] = useState<ImportMeta | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const phaseTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (step === "analyzing") {
      setPhaseIdx(0)
      phaseTimer.current = setInterval(() => {
        setPhaseIdx((i) => Math.min(i + 1, PHASE_LABELS.length - 1))
      }, 3500)
    } else if (phaseTimer.current) {
      clearInterval(phaseTimer.current)
      phaseTimer.current = null
    }
    return () => {
      if (phaseTimer.current) clearInterval(phaseTimer.current)
    }
  }, [step])

  function resetAll() {
    setStep("source")
    setSourceKind("pdf")
    setPdfFile(null)
    setConfluenceUrl("")
    setCodeText("")
    setCodeLanguage("auto")
    setCodeFilename(undefined)
    setCandidates([])
    setSelected({})
    setMeta(null)
    setErrorMsg(null)
    setErrorKind(null)
    setImporting(false)
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetAll()
    onOpenChange(next)
  }

  async function runAnalysis() {
    setErrorMsg(null)
    setErrorKind(null)
    setStep("analyzing")
    try {
      let res: Response
      if (sourceKind === "pdf") {
        if (!pdfFile) throw new Error("No PDF selected.")
        const form = new FormData()
        form.append("file", pdfFile)
        form.append("kind", "pdf")
        res = await fetch(`/api/components/${componentId}/rules-import`, {
          method: "POST",
          body: form,
        })
      } else if (sourceKind === "confluence") {
        if (!confluenceUrl.trim()) throw new Error("Paste a Confluence URL or page id.")
        res = await fetch(`/api/components/${componentId}/rules-import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: { type: "confluence", url: confluenceUrl.trim() } }),
        })
      } else {
        // code
        if (!codeText.trim()) throw new Error("Paste source code or upload a file.")
        res = await fetch(`/api/components/${componentId}/rules-import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: {
              type: "code",
              text: codeText,
              language: codeLanguage !== "auto" ? codeLanguage : undefined,
              filename: codeFilename,
            },
          }),
        })
      }
      // Read defensively: a gateway timeout, an upload-too-large rejection
      // or an expired session returns an HTML error page, not JSON. Blindly
      // calling res.json() on that throws "Unexpected token '<'".
      const raw = await res.text()
      let data: ApiResponse | null = null
      try {
        data = raw ? (JSON.parse(raw) as ApiResponse) : null
      } catch {
        data = null
      }
      if (!data) {
        const hint =
          res.status === 413
            ? "The document is too large for the server to accept. Try a smaller file or split it."
            : res.status === 504 || res.status === 502 || res.status === 408
            ? "The analysis took too long and the server timed out. Try a smaller or more focused source (a single section, the relevant code file, or one Confluence page)."
            : res.status === 401 || res.status === 403
            ? "Your session may have expired. Reload the page, sign in again, and retry."
            : `The server returned an unexpected response (HTTP ${res.status || "?"}). Please try again, or use a smaller source.`
        setErrorKind("server")
        setErrorMsg(hint)
        setStep("error")
        return
      }
      if (!data.ok) {
        setErrorKind(data.error)
        setErrorMsg(data.message)
        setStep("error")
        return
      }
      setCandidates(data.candidates)
      setMeta(data.meta)
      // Default selection: every non-duplicate is checked, duplicates
      // are unchecked (the analyst opts in explicitly).
      const initial: Record<number, boolean> = {}
      data.candidates.forEach((c, i) => {
        initial[i] = c.duplicate_of_index === null || c.duplicate_of_index === undefined
      })
      setSelected(initial)
      setStep("review")
    } catch (e) {
      setErrorKind("client")
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setStep("error")
    }
  }

  function updateCandidate<K extends keyof Candidate>(
    index: number,
    key: K,
    value: Candidate[K]
  ) {
    setCandidates((prev) => prev.map((c, i) => (i === index ? { ...c, [key]: value } : c)))
  }

  const selectedCount = useMemo(
    () => Object.values(selected).filter(Boolean).length,
    [selected]
  )

  function setAllSelected(value: boolean) {
    const next: Record<number, boolean> = {}
    candidates.forEach((_, i) => (next[i] = value))
    setSelected(next)
  }

  async function handleImport() {
    setImporting(true)
    try {
      const newRules: ComponentRule[] = []
      candidates.forEach((c, i) => {
        if (!selected[i]) return
        const rule: ComponentRule = {
          name: c.name.trim() || "(unnamed rule)",
          kind: c.kind,
        }
        if (c.summary) rule.summary = c.summary
        if (c.description) rule.description = c.description
        if (c.kind === "formula" && c.formula) rule.formula = c.formula
        if (c.kind === "rule") {
          if (c.given) rule.given = c.given
          if (c.when) rule.when = c.when
          if (c.then) rule.then = c.then
        }
        if (c.kind === "constraint" && c.enforced_in) {
          const ids = c.enforced_in
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
          if (ids.length > 0) rule.enforced_in = ids
        }
        newRules.push(rule)
      })
      const err = await onImport(newRules)
      if (err) {
        setErrorKind("save")
        setErrorMsg(err)
        setStep("error")
      } else {
        handleOpenChange(false)
      }
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
    <AgentRunModal
      open={step === "analyzing"}
      title="Rules import"
      nodes={[
        { label: "Rules locator", icon: "🔍" },
        { label: "Rules extractor", icon: "📐" },
      ]}
      stages={[
        "Reading the source document or code…",
        "Locating passages that carry business rules…",
        "Extracting each rule into the structured catalog…",
        "Preparing candidates for your review…",
      ]}
    />
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-500" />
            Import rules from documents
          </DialogTitle>
          <DialogDescription>
            AI scans the source for business rules, calculations and constraints relevant to <strong>{componentName}</strong>, then lets you review and pick which to append.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {step === "source" && (
            <SourceStep
              sourceKind={sourceKind}
              setSourceKind={setSourceKind}
              pdfFile={pdfFile}
              setPdfFile={setPdfFile}
              confluenceUrl={confluenceUrl}
              setConfluenceUrl={setConfluenceUrl}
              codeText={codeText}
              setCodeText={setCodeText}
              codeLanguage={codeLanguage}
              setCodeLanguage={setCodeLanguage}
              codeFilename={codeFilename}
              setCodeFilename={setCodeFilename}
            />
          )}

          {step === "analyzing" && <AnalyzingStep phaseLabel={PHASE_LABELS[phaseIdx]} />}

          {step === "error" && (
            <ErrorStep
              kind={errorKind}
              message={errorMsg || "Unknown error"}
              onBack={() => setStep("source")}
            />
          )}

          {step === "review" && meta && (
            <ReviewStep
              candidates={candidates}
              selected={selected}
              setSelected={setSelected}
              setAllSelected={setAllSelected}
              updateCandidate={updateCandidate}
              meta={meta}
              existingRules={existingRules}
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t pt-3 mt-2">
          {step === "source" && (
            <>
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>Cancel</Button>
              <Button
                onClick={runAnalysis}
                disabled={
                  sourceKind === "pdf"
                    ? !pdfFile
                    : sourceKind === "confluence"
                    ? !confluenceUrl.trim()
                    : !codeText.trim()
                }
              >
                <Sparkles className="h-4 w-4 mr-1" />
                Analyze
              </Button>
            </>
          )}
          {step === "analyzing" && (
            <Button variant="ghost" disabled className="ml-auto">
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Working...
            </Button>
          )}
          {step === "error" && (
            <Button variant="ghost" onClick={() => handleOpenChange(false)} className="ml-auto">
              Close
            </Button>
          )}
          {step === "review" && (
            <>
              <Button variant="ghost" onClick={() => setStep("source")}>Back</Button>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {selectedCount} of {candidates.length} selected
                </span>
                <Button onClick={handleImport} disabled={importing || selectedCount === 0}>
                  {importing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-1" />
                      Import {selectedCount} rule{selectedCount === 1 ? "" : "s"}
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}

// ----- Steps -----------------------------------------------------------

function SourceStep({
  sourceKind,
  setSourceKind,
  pdfFile,
  setPdfFile,
  confluenceUrl,
  setConfluenceUrl,
  codeText,
  setCodeText,
  codeLanguage,
  setCodeLanguage,
  codeFilename,
  setCodeFilename,
}: {
  sourceKind: SourceKind
  setSourceKind: (s: SourceKind) => void
  pdfFile: File | null
  setPdfFile: (f: File | null) => void
  confluenceUrl: string
  setConfluenceUrl: (s: string) => void
  codeText: string
  setCodeText: (s: string) => void
  codeLanguage: string
  setCodeLanguage: (s: string) => void
  codeFilename: string | undefined
  setCodeFilename: (s: string | undefined) => void
}) {
  async function handleCodeFile(file: File | undefined) {
    if (!file) return
    try {
      const text = await file.text()
      setCodeText(text)
      setCodeFilename(file.name)
      // Best-effort detect from extension on the client; the server
      // re-detects to be safe.
      const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] || ""
      const guessed = LANGUAGE_OPTIONS.find((o) =>
        o.value !== "auto" && file.name.toLowerCase().endsWith(`.${o.value}`)
      )
      if (guessed) setCodeLanguage(guessed.value)
      else if (ext === ".py") setCodeLanguage("python")
      else if (ext === ".cs") setCodeLanguage("csharp")
      else if (ext === ".ts" || ext === ".tsx") setCodeLanguage("typescript")
      else if (ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs")
        setCodeLanguage("javascript")
      else if (ext === ".cob" || ext === ".cbl") setCodeLanguage("cobol")
    } catch {
      // ignore — user can still paste
    }
  }
  return (
    <div className="space-y-4 px-1">
      <div className="flex gap-2 border-b">
        <button
          type="button"
          onClick={() => setSourceKind("pdf")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
            sourceKind === "pdf"
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileText className="h-4 w-4 inline mr-1" />
          PDF upload
        </button>
        <button
          type="button"
          onClick={() => setSourceKind("confluence")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
            sourceKind === "confluence"
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Globe className="h-4 w-4 inline mr-1" />
          Confluence URL
        </button>
        <button
          type="button"
          onClick={() => setSourceKind("code")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
            sourceKind === "code"
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <CodeIcon className="h-4 w-4 inline mr-1" />
          Source code
        </button>
      </div>

      {sourceKind === "pdf" && (
        <div className="space-y-3">
          <Label htmlFor="rules-import-pdf">Choose a PDF or Excel (.xlsx)</Label>
          <div className="flex items-center gap-3">
            <input
              id="rules-import-pdf"
              type="file"
              accept="application/pdf,.pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
              className="block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-md file:border file:border-input file:bg-background file:text-sm file:font-medium file:cursor-pointer hover:file:bg-muted"
            />
          </div>
          {pdfFile && (
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Upload className="h-3.5 w-3.5" />
              {pdfFile.name} · {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Max 12 MB. Scanned image-only PDFs are not supported — run OCR first.
          </p>
        </div>
      )}

      {sourceKind === "confluence" && (
        <div className="space-y-3">
          <Label htmlFor="rules-import-url">Confluence page URL or page id</Label>
          <Input
            id="rules-import-url"
            placeholder="https://confluence.acme.com/pages/viewpage.action?pageId=12345"
            value={confluenceUrl}
            onChange={(e) => setConfluenceUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Accepts <code>/pages/&#123;id&#125;/</code> (Cloud), <code>pageId=&#123;id&#125;</code> (Data Center), or just the numeric page id. <code>/display/Title</code> URLs without a pageId are not supported — open the page and copy the URL with the numeric id.
          </p>
        </div>
      )}

      {sourceKind === "code" && (
        <div className="space-y-3">
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <Label htmlFor="rules-import-code-file">Upload a source file (optional)</Label>
              <input
                id="rules-import-code-file"
                type="file"
                accept=".java,.kt,.kts,.cs,.py,.js,.mjs,.cjs,.ts,.tsx,.jsx,.go,.rs,.rb,.php,.swift,.cpp,.cc,.hpp,.c,.h,.sql,.cob,.cbl,.cobol,.pli,.pl1,.scala,.groovy,.lua,.r,.pl,.sh,.bash,.ps1,.dart"
                onChange={(e) => handleCodeFile(e.target.files?.[0])}
                className="block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-md file:border file:border-input file:bg-background file:text-sm file:font-medium file:cursor-pointer hover:file:bg-muted mt-1"
              />
            </div>
            <div className="min-w-[180px]">
              <Label htmlFor="rules-import-code-lang">Language</Label>
              <Select value={codeLanguage} onValueChange={setCodeLanguage}>
                <SelectTrigger id="rules-import-code-lang" className="h-9 mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="rules-import-code-text">Or paste the source code</Label>
            <Textarea
              id="rules-import-code-text"
              value={codeText}
              onChange={(e) => setCodeText(e.target.value)}
              rows={14}
              className="font-mono text-xs mt-1"
              placeholder={`// Paste a class, function, stored procedure, COBOL paragraph, etc.\n// AI will identify business logic relevant to ${"{this component}"} and propose Formula / Given-When-Then / Constraint candidates.`}
            />
          </div>
          {codeFilename && (
            <div className="text-xs text-muted-foreground">
              From file: <code className="font-mono">{codeFilename}</code>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            AI reads the code, ignores plumbing (logging, DI, HTTP routing,
            tests, getters/setters, imports) and emits rule candidates with
            verbatim source excerpts as evidence. Algebraic formulas are
            extracted with the original variable names so you can verify
            against the source. Max 320,000 characters per import.
          </p>
        </div>
      )}
    </div>
  )
}

function AnalyzingStep({ phaseLabel }: { phaseLabel: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      <div className="text-sm font-medium">{phaseLabel}</div>
      <div className="text-xs text-muted-foreground">
        Large documents may take 10-30 seconds. The relevance filter runs first to keep the extraction focused.
      </div>
    </div>
  )
}

function ErrorStep({
  kind,
  message,
  onBack,
}: {
  kind: string | null
  message: string
  onBack: () => void
}) {
  const isCap = kind === "token-cap-exceeded"
  return (
    <div className="space-y-4 py-4 px-1">
      <div
        className={`flex items-start gap-3 rounded-md border p-4 ${
          isCap
            ? "border-orange-300 bg-orange-50 text-orange-900"
            : "border-destructive/40 bg-destructive/5 text-destructive"
        }`}
      >
        <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-medium">
            {isCap
              ? "Document is too large to analyse"
              : kind === "no-relevant-sections"
              ? "No relevant rules found"
              : kind === "no-candidates"
              ? "No structured rules extracted"
              : kind === "llm-not-configured"
              ? "AI is not configured"
              : "Something went wrong"}
          </div>
          <div className="text-sm break-words">{message}</div>
        </div>
      </div>
      <Button variant="outline" onClick={onBack}>
        <X className="h-4 w-4 mr-1" />
        Choose a different source
      </Button>
    </div>
  )
}

function ReviewStep({
  candidates,
  selected,
  setSelected,
  setAllSelected,
  updateCandidate,
  meta,
  existingRules,
}: {
  candidates: Candidate[]
  selected: Record<number, boolean>
  setSelected: React.Dispatch<React.SetStateAction<Record<number, boolean>>>
  setAllSelected: (v: boolean) => void
  updateCandidate: <K extends keyof Candidate>(index: number, key: K, value: Candidate[K]) => void
  meta: ImportMeta
  existingRules: ComponentRule[]
}) {
  return (
    <div className="space-y-3 px-1">
      <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
        <span>
          <strong>{meta.docName}</strong> · {meta.docChars.toLocaleString()} chars
        </span>
        <span>·</span>
        <span>
          {meta.pass1Skipped
            ? "Pass 1 skipped (short document)"
            : `${meta.relevantSectionsCount} relevant section${meta.relevantSectionsCount === 1 ? "" : "s"}`}
        </span>
        <span>·</span>
        <span>{candidates.length} candidates · {meta.totalMs}ms</span>
        <span className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => setAllSelected(true)}
            className="underline hover:text-foreground"
          >
            Select all
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={() => setAllSelected(false)}
            className="underline hover:text-foreground"
          >
            Clear
          </button>
        </span>
      </div>

      <div className="space-y-3">
        {candidates.map((c, i) => (
          <CandidateRow
            key={i}
            index={i}
            candidate={c}
            checked={!!selected[i]}
            onToggle={() => setSelected((p) => ({ ...p, [i]: !p[i] }))}
            update={(k, v) => updateCandidate(i, k, v)}
            existingRules={existingRules}
          />
        ))}
      </div>
    </div>
  )
}

function ConfidenceBadge({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const cls =
    confidence === "high"
      ? "bg-green-100 text-green-800 border-green-200"
      : confidence === "medium"
      ? "bg-yellow-100 text-yellow-800 border-yellow-200"
      : "bg-gray-100 text-gray-700 border-gray-200"
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${cls}`}>
      {confidence}
    </span>
  )
}

function CandidateRow({
  index,
  candidate,
  checked,
  onToggle,
  update,
  existingRules,
}: {
  index: number
  candidate: Candidate
  checked: boolean
  onToggle: () => void
  update: <K extends keyof Candidate>(key: K, value: Candidate[K]) => void
  existingRules: ComponentRule[]
}) {
  const isDup =
    candidate.duplicate_of_index !== null &&
    candidate.duplicate_of_index !== undefined &&
    candidate.duplicate_of_index >= 0
  const dupName =
    isDup && candidate.duplicate_of_index !== undefined && candidate.duplicate_of_index !== null
      ? existingRules[candidate.duplicate_of_index]?.name
      : null

  return (
    <div
      className={`rounded-md border p-3 space-y-2 ${
        isDup ? "border-orange-200 bg-orange-50/30" : checked ? "bg-muted/20" : "opacity-60"
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          aria-label={`Select ${candidate.name}`}
        />
        <div className="flex-1 space-y-2">
          <div className="grid grid-cols-[1fr,160px] gap-2 items-start">
            <Input
              value={candidate.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="Rule name"
              className="h-9"
            />
            <Select
              value={candidate.kind}
              onValueChange={(v) => update("kind", v as RuleKind)}
            >
              <SelectTrigger className="h-9">
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
          </div>

          <Input
            value={candidate.summary || ""}
            onChange={(e) => update("summary", e.target.value)}
            placeholder="Summary (one line)"
            className="h-9 text-sm"
          />

          {candidate.kind === "formula" && (
            <Input
              value={candidate.formula || ""}
              onChange={(e) => update("formula", e.target.value)}
              placeholder="Formula — e.g. total = base * (1 + rate)"
              className="h-9 font-mono text-xs"
            />
          )}
          {candidate.kind === "rule" && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input
                value={candidate.given || ""}
                onChange={(e) => update("given", e.target.value)}
                placeholder="Given (precondition)"
                className="h-9 text-sm"
              />
              <Input
                value={candidate.when || ""}
                onChange={(e) => update("when", e.target.value)}
                placeholder="When (trigger)"
                className="h-9 text-sm"
              />
              <Input
                value={candidate.then || ""}
                onChange={(e) => update("then", e.target.value)}
                placeholder="Then (outcome)"
                className="h-9 text-sm"
              />
            </div>
          )}
          {candidate.kind === "constraint" && (
            <Input
              value={candidate.enforced_in || ""}
              onChange={(e) => update("enforced_in", e.target.value)}
              placeholder="Enforced in — comma-separated component ids (optional)"
              className="h-9 text-sm"
            />
          )}

          {candidate.description && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Description
              </summary>
              <Textarea
                value={candidate.description}
                onChange={(e) => update("description", e.target.value)}
                rows={3}
                className="mt-1 text-xs"
              />
            </details>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <ConfidenceBadge confidence={candidate.confidence} />
            {candidate.sourceSection && (
              <span className="font-mono text-[11px]">{candidate.sourceSection}</span>
            )}
            {isDup && (
              <span className="inline-flex items-center gap-1 text-orange-800 bg-orange-100 border border-orange-200 rounded px-1.5 py-0.5">
                <AlertTriangle className="h-3 w-3" />
                Looks like existing rule [{candidate.duplicate_of_index}] {dupName ? `· ${dupName}` : ""}
              </span>
            )}
          </div>

          {candidate.evidence && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Evidence
              </summary>
              <blockquote className="mt-1 border-l-2 border-border pl-2 italic text-[11px] break-words">
                &ldquo;{candidate.evidence}&rdquo;
              </blockquote>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}
