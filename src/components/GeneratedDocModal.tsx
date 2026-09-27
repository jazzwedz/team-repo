"use client"

// Reusable viewer for a generated Markdown document (component docs,
// solution DSD, …). Same styled rendering + mermaid support as the
// component detail doc modal, plus Copy Markdown, Save as PDF (print)
// and an optional Publish action.

import { useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { FileText, Copy, Check, Send, X, Printer, ThumbsUp, ThumbsDown, Loader2, Pencil, Save, Download, RefreshCw } from "lucide-react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { MermaidPreview } from "@/components/mermaid-preview"

// Shared rendering for the read view and the live edit preview.
const DOC_PROSE =
  "max-w-none [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:border-b-2 [&_h1]:border-gray-800 [&_h1]:pb-2 [&_h1]:mb-4 [&_h1]:text-gray-900 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:border-gray-300 [&_h2]:pb-1 [&_h2]:text-gray-800 [&_h3]:text-base [&_h3]:font-bold [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-gray-700 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:my-2 [&_p]:text-gray-700 [&_ul]:pl-6 [&_ul]:my-2 [&_ol]:pl-6 [&_ol]:my-2 [&_li]:text-sm [&_li]:my-1 [&_li]:text-gray-700 [&_code]:bg-gray-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:text-gray-800 [&_pre]:bg-gray-100 [&_pre]:p-4 [&_pre]:rounded-md [&_pre]:overflow-x-auto [&_pre]:my-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:w-full [&_table]:border-collapse [&_table]:my-3 [&_th]:border [&_th]:border-gray-300 [&_th]:bg-gray-100 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-sm [&_th]:font-semibold [&_td]:border [&_td]:border-gray-300 [&_td]:px-3 [&_td]:py-2 [&_td]:text-sm [&_strong]:font-semibold [&_strong]:text-gray-900 [&_hr]:my-4 [&_hr]:border-gray-200"

// "spec" theme — the look of a formal specification document: a title
// block with a colour accent bar, chapter headings underlined in the
// accent colour, tables with an accent header rule and zebra rows, and
// blockquotes rendered as a warning callout (used for the sign-off
// warning on the cover). Same markdown, different clothes.
const SPEC_PROSE =
  "max-w-none [&_h1]:text-3xl [&_h1]:font-extrabold [&_h1]:tracking-tight [&_h1]:border-l-8 [&_h1]:border-red-700 [&_h1]:pl-4 [&_h1]:py-1 [&_h1]:mb-6 [&_h1]:text-gray-900 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:border-b-2 [&_h2]:border-red-700 [&_h2]:pb-1 [&_h2]:text-gray-900 [&_h3]:text-base [&_h3]:font-bold [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-red-800 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:my-2 [&_p]:text-gray-700 [&_ul]:pl-6 [&_ul]:my-2 [&_ol]:pl-6 [&_ol]:my-2 [&_li]:text-sm [&_li]:my-1 [&_li]:text-gray-700 [&_code]:bg-gray-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:text-gray-800 [&_pre]:bg-gray-100 [&_pre]:p-4 [&_pre]:rounded-md [&_pre]:overflow-x-auto [&_pre]:my-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:w-full [&_table]:border-collapse [&_table]:my-3 [&_th]:border-0 [&_th]:border-b-2 [&_th]:border-red-700 [&_th]:bg-transparent [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wide [&_th]:font-semibold [&_th]:text-gray-700 [&_td]:border-0 [&_td]:border-b [&_td]:border-gray-200 [&_td]:px-3 [&_td]:py-1.5 [&_td]:text-sm [&_td]:align-top [&_tbody_tr:nth-child(odd)]:bg-gray-50 [&_strong]:font-semibold [&_strong]:text-gray-900 [&_em]:not-italic [&_em]:font-semibold [&_em]:text-gray-600 [&_hr]:my-6 [&_hr]:border-red-200 [&_blockquote]:border-l-4 [&_blockquote]:border-red-700 [&_blockquote]:bg-red-50 [&_blockquote]:px-4 [&_blockquote]:py-2 [&_blockquote]:my-4 [&_blockquote]:not-italic [&_blockquote_p]:text-red-900 [&_blockquote_p]:my-1"

// "terminal" theme — for the coding-agent brief: a dark, monospace,
// CLI-like rendering (prompt-style title, amber/green headings, dim table
// rules) so it reads at a glance as a different kind of document from the
// specification it was derived from.
const TERMINAL_PROSE =
  "max-w-none font-mono text-[13px] leading-relaxed text-slate-200 [&_h1]:text-emerald-400 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:before:content-['>_'] [&_h1]:before:text-emerald-600 [&_h2]:text-amber-300 [&_h2]:text-[13px] [&_h2]:font-bold [&_h2]:uppercase [&_h2]:tracking-widest [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:border-slate-700 [&_h2]:pb-1 [&_h2]:before:content-['##_'] [&_h2]:before:text-slate-500 [&_h3]:text-emerald-300 [&_h3]:text-[13px] [&_h3]:font-bold [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:before:content-['###_'] [&_h3]:before:text-slate-500 [&_p]:my-2 [&_p]:text-slate-200 [&_blockquote]:border-l-2 [&_blockquote]:border-slate-600 [&_blockquote]:pl-3 [&_blockquote]:my-3 [&_blockquote_p]:text-slate-400 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-2 [&_li]:my-1 [&_li]:text-slate-200 [&_li]:marker:text-slate-500 [&_code]:bg-slate-800 [&_code]:text-emerald-300 [&_code]:px-1 [&_code]:rounded [&_code]:text-[12px] [&_pre]:bg-slate-900 [&_pre]:border [&_pre]:border-slate-700 [&_pre]:p-3 [&_pre]:rounded [&_pre]:my-3 [&_pre_code]:bg-transparent [&_table]:w-full [&_table]:border-collapse [&_table]:my-3 [&_table]:text-[12px] [&_th]:border [&_th]:border-slate-700 [&_th]:bg-slate-800 [&_th]:text-amber-200 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-slate-800 [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_strong]:text-white [&_strong]:font-bold [&_em]:text-slate-400 [&_a]:text-sky-300 [&_hr]:border-slate-700 [&_input]:accent-emerald-500 [&_input]:mr-1"

export type DocTheme = "default" | "spec" | "terminal"

// Print (Save as PDF) stylesheet per theme — mirrors the on-screen look.
function printCss(theme: DocTheme): string {
  const base =
    `body{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#1f2937;max-width:820px;margin:24px auto;padding:0 24px;line-height:1.55}` +
    `p,li{font-size:13.5px}` +
    `table{width:100%;border-collapse:collapse;margin:12px 0}` +
    `code{background:#f3f4f6;padding:2px 4px;border-radius:3px;font-size:12px}` +
    `pre{background:#f3f4f6;padding:12px;border-radius:6px;overflow:auto}` +
    `svg{max-width:100%;height:auto}` +
    `h2,h3{page-break-after:avoid}table,pre,blockquote{page-break-inside:avoid}`
  if (theme === "terminal") {
    return (
      base +
      `body{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#111827}` +
      `h1{font-size:18px;margin:0 0 16px}h1:before{content:"> ";color:#059669}` +
      `h2{font-size:13px;text-transform:uppercase;letter-spacing:.12em;border-bottom:1px solid #d1d5db;padding-bottom:4px;margin-top:28px}h2:before{content:"## ";color:#9ca3af}` +
      `h3{font-size:13px;margin-top:18px}h3:before{content:"### ";color:#9ca3af}` +
      `p,li{font-size:12.5px}th,td{border:1px solid #d1d5db;padding:4px 8px;font-size:11.5px;text-align:left;vertical-align:top}th{background:#f3f4f6}` +
      `blockquote{border-left:2px solid #9ca3af;margin:12px 0;padding-left:12px;color:#4b5563}`
    )
  }
  if (theme === "spec") {
    return (
      base +
      `h1{font-size:30px;font-weight:800;letter-spacing:-0.01em;border-left:10px solid #b91c1c;padding:4px 0 4px 16px;margin:0 0 24px}` +
      `h2{font-size:20px;border-bottom:2px solid #b91c1c;padding-bottom:4px;margin-top:30px}` +
      `h3{font-size:15px;color:#991b1b;margin-top:22px}` +
      `th{border:0;border-bottom:2px solid #b91c1c;padding:5px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;text-align:left;color:#374151}` +
      `td{border:0;border-bottom:1px solid #e5e7eb;padding:5px 10px;font-size:12.5px;vertical-align:top}` +
      `tbody tr:nth-child(odd){background:#f9fafb}` +
      `em{font-style:normal;font-weight:600;color:#4b5563}` +
      `hr{border:0;border-top:1px solid #fecaca;margin:24px 0}` +
      `blockquote{border-left:4px solid #b91c1c;background:#fef2f2;margin:16px 0;padding:8px 16px}blockquote p{color:#7f1d1d;margin:4px 0}`
    )
  }
  return (
    base +
    `h1{font-size:24px;border-bottom:2px solid #1f2937;padding-bottom:6px;margin-top:0}` +
    `h2{font-size:20px;border-bottom:1px solid #d1d5db;padding-bottom:4px;margin-top:26px}` +
    `h3{font-size:16px;margin-top:20px}` +
    `th,td{border:1px solid #d1d5db;padding:6px 10px;font-size:12.5px;text-align:left}` +
    `th{background:#f3f4f6}`
  )
}

const MD_COMPONENTS: Components = {
  code({ className, children, ...props }) {
    const isMermaid = /language-mermaid/.test(className || "")
    if (isMermaid) {
      return <MermaidPreview chart={String(children).trim()} />
    }
    const isInline = !className
    if (isInline) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      )
    }
    return (
      <pre className="bg-gray-100 p-4 rounded-md overflow-x-auto my-3">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    )
  },
  pre({ children }) {
    return <>{children}</>
  },
}

export interface DocFeedback {
  /** Submit analyst feedback. Returns an error string or void. */
  onSubmit: (
    rating: "up" | "down",
    comment: string,
    correctedText: string,
    section?: string
  ) => Promise<string | void>
  existingCount?: number
  /** Section groups (writer agentIds) for targeted feedback. Omitted/empty =
   *  whole-document feedback only (e.g. quick-mode docs). */
  sections?: { id: string; title: string }[]
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  badge?: string
  markdown: string
  /** Optional publish action (e.g. to Confluence). Hidden when omitted. */
  publish?: { onPublish: () => void | Promise<void>; label?: string; busy?: boolean }
  /** Optional analyst feedback bar (training signal for the coach). */
  feedback?: DocFeedback
  /** When set, the document becomes editable: an Edit toggle reveals the raw
   *  markdown for hand-editing and a Save persists it. The table of contents
   *  is re-derived server-side, so it isn't hand-edited. onSave returns an
   *  error string or void. */
  editable?: { onSave: (markdown: string) => Promise<string | void>; busy?: boolean }
  /** Visual theme: "default" (technical doc) or "spec" (formal specification look). */
  theme?: DocTheme
  /** When set, a "Download .md" button saves the markdown under this file name. */
  download?: { filename: string }
  /** When set, a "Regenerate" button re-derives the document (e.g. a coding brief). */
  regenerate?: { onRegenerate: () => void; busy?: boolean }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"
  )
}

export function GeneratedDocModal({ open, onOpenChange, title, badge, markdown, publish, feedback, editable, theme = "default", download, regenerate }: Props) {
  const prose = theme === "spec" ? SPEC_PROSE : theme === "terminal" ? TERMINAL_PROSE : DOC_PROSE
  const paper = theme === "terminal" ? "bg-[#0b0f14]" : "bg-white"

  // Download the raw markdown as a file (for briefs handed to a coding agent).
  const downloadMd = () => {
    if (!markdown || !download) return
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = download.filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const [copied, setCopied] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  // edit state
  const [editing, setEditing] = useState(false)
  const [editMode, setEditMode] = useState<"wysiwyg" | "markdown">("wysiwyg")
  const [draft, setDraft] = useState("")
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  // Reset edit mode whenever the modal is closed or a different doc loads.
  useEffect(() => {
    if (!open) {
      setEditing(false)
      setSaveErr(null)
    }
  }, [open])

  const startEdit = () => {
    setDraft(markdown || "")
    setSaveErr(null)
    setEditing(true)
  }
  const saveEdit = async () => {
    if (!editable) return
    setSaveBusy(true)
    setSaveErr(null)
    try {
      const err = await editable.onSave(draft)
      if (err) setSaveErr(err)
      else setEditing(false)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaveBusy(false)
    }
  }

  // feedback bar state
  const [fbOpen, setFbOpen] = useState(false)
  const [fbRating, setFbRating] = useState<"up" | "down" | null>(null)
  const [fbComment, setFbComment] = useState("")
  const [fbCorrection, setFbCorrection] = useState("")
  const [fbSection, setFbSection] = useState("")
  const [fbBusy, setFbBusy] = useState(false)
  const [fbDone, setFbDone] = useState(false)
  const [fbError, setFbError] = useState<string | null>(null)

  const submitFeedback = async (rating: "up" | "down") => {
    if (!feedback) return
    setFbRating(rating)
    setFbBusy(true)
    setFbError(null)
    try {
      const err = await feedback.onSubmit(rating, fbComment, fbCorrection, fbSection || undefined)
      if (err) {
        setFbError(err)
      } else {
        setFbDone(true)
        setFbComment("")
        setFbCorrection("")
        setFbOpen(false)
      }
    } finally {
      setFbBusy(false)
    }
  }

  const copy = () => {
    if (!markdown) return
    navigator.clipboard.writeText(markdown).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  // Save as PDF — open a clean print window with the already-rendered
  // HTML (tables, mermaid SVG and all) and trigger the browser's print
  // dialog, where the user picks "Save as PDF".
  const saveAsPdf = () => {
    const html = contentRef.current?.innerHTML
    if (!html) return
    const w = window.open("", "_blank", "width=900,height=1000")
    if (!w) return
    w.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
        `<style>${printCss(theme)}</style></head><body>${html}</body></html>`
    )
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 350)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 [&>button:last-child]:hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0 bg-gray-50">
          <DialogHeader className="flex-1">
            <DialogTitle className="flex items-center gap-3">
              <FileText className="h-5 w-5" />
              <span>{title}</span>
              {badge && (
                <span
                  className={`inline-flex items-center px-3 py-1 rounded text-xs font-semibold uppercase tracking-wide ${
                    theme === "terminal" ? "bg-emerald-500 text-black font-mono" : "bg-gray-900 text-white"
                  }`}
                >
                  {theme === "terminal" ? `$ ${badge}` : badge}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <Button size="sm" onClick={saveEdit} disabled={saveBusy}>
                  {saveBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                  Save
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={saveBusy}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={copy}>
                  {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                  {copied ? "Copied" : "Copy Markdown"}
                </Button>
                <Button variant="outline" size="sm" onClick={saveAsPdf}>
                  <Printer className="h-4 w-4 mr-1" />
                  Save as PDF
                </Button>
                {download && (
                  <Button variant="outline" size="sm" onClick={downloadMd} title={`Download ${download.filename}`}>
                    <Download className="h-4 w-4 mr-1" />
                    Download .md
                  </Button>
                )}
                {regenerate && (
                  <Button variant="outline" size="sm" onClick={regenerate.onRegenerate} disabled={regenerate.busy} title="Re-derive this document">
                    {regenerate.busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                    Regenerate
                  </Button>
                )}
                {editable && (
                  <Button variant="outline" size="sm" onClick={startEdit} title="Edit the document (the table of contents is kept derived)">
                    <Pencil className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                )}
                {publish && (
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={publish.onPublish}
                    disabled={publish.busy}
                  >
                    <Send className="h-4 w-4 mr-1" />
                    {publish.label || "Publish to Confluence"}
                  </Button>
                )}
                {feedback && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFbOpen((o) => !o)}
                    title="Rate this document — trains the writer & critic"
                  >
                    {fbDone ? <Check className="h-4 w-4 mr-1 text-emerald-600" /> : <ThumbsUp className="h-4 w-4 mr-1" />}
                    Feedback
                    {feedback.existingCount ? ` (${feedback.existingCount})` : ""}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                  <X className="h-4 w-4 mr-1" />
                  Close
                </Button>
              </>
            )}
          </div>
        </div>

        {feedback && fbOpen && (
          <div className="px-6 py-3 border-b bg-amber-50/60 shrink-0 space-y-2">
            <div className="text-sm font-medium">How is this document? Your feedback trains the agent team.</div>
            {feedback.sections && feedback.sections.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">About:</span>
                <select
                  value={fbSection}
                  onChange={(e) => setFbSection(e.target.value)}
                  className="h-8 rounded-md border bg-white px-2 text-sm"
                >
                  <option value="">Whole document</option>
                  {feedback.sections.map((s) => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
                <span className="text-[11px] text-muted-foreground">— picking a section trains that specific writer</span>
              </div>
            )}
            <Textarea
              value={fbComment}
              onChange={(e) => setFbComment(e.target.value)}
              rows={2}
              placeholder="What's good or wrong? (optional)"
              className="bg-white text-sm"
            />
            <Textarea
              value={fbCorrection}
              onChange={(e) => setFbCorrection(e.target.value)}
              rows={2}
              placeholder="Suggested correction — how a section should read (optional, strongest signal)"
              className="bg-white text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              A correction (with a section picked above) becomes a <span className="font-medium">golden example</span> that
              trains that writer next time — so future drafts match your style automatically.
            </p>
            {fbError && <div className="text-xs text-red-700">{fbError}</div>}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={fbBusy} onClick={() => submitFeedback("up")}>
                {fbBusy && fbRating === "up" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ThumbsUp className="h-4 w-4 mr-1" />}
                Good
              </Button>
              <Button size="sm" variant="outline" disabled={fbBusy} onClick={() => submitFeedback("down")}>
                {fbBusy && fbRating === "down" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ThumbsDown className="h-4 w-4 mr-1" />}
                Needs work
              </Button>
            </div>
          </div>
        )}
        {editing ? (
          <div className="flex-1 overflow-y-auto px-6 py-4 bg-white flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-muted-foreground">
                Everything is editable; the <span className="font-medium">Table of Contents</span> is re-derived from your headings on save.
              </p>
              <div className="flex gap-1 rounded-md border p-0.5 shrink-0">
                {([
                  { v: "wysiwyg", label: "Rich" },
                  { v: "markdown", label: "Markdown" },
                ] as const).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setEditMode(o.v)}
                    className={`px-2.5 py-1 rounded text-xs font-medium ${editMode === o.v ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            {saveErr && <div className="text-xs text-red-700">{saveErr}</div>}
            {editMode === "wysiwyg" ? (
              // Split: raw markdown on the left, live rendered preview on the
              // right (reuses the read-view renderer; no extra dependency).
              <div className="flex-1 grid grid-cols-2 gap-3 min-h-[50vh]">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="h-full min-h-[50vh] font-mono text-xs bg-white"
                />
                <div className={`h-full overflow-y-auto rounded-md border p-3 bg-white ${prose}`}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                    {draft || "_Nothing to preview yet._"}
                  </ReactMarkdown>
                </div>
              </div>
            ) : (
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="flex-1 min-h-[50vh] font-mono text-xs bg-white"
              />
            )}
          </div>
        ) : (
        <div className={`flex-1 overflow-y-auto px-8 py-6 ${paper}`}>
          {theme === "terminal" && (
            <div className="font-mono text-xs text-slate-500 mb-4 select-none">
              <span className="text-emerald-500">❯</span> agent run --brief {download?.filename || "brief.md"}
              <span className="ml-2 text-slate-600">— one file, self-contained; hand it to a coding agent as its task</span>
            </div>
          )}
          <div ref={contentRef} className={prose}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
              {markdown || ""}
            </ReactMarkdown>
          </div>
        </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
