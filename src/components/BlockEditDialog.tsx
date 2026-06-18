"use client"

// Focused edit dialog — opens a modal with ONLY the form fields for a
// single block (Links, NFR, Capabilities, Processes, Rules, Risks,
// Description). Reuses ComponentForm with `focusBlock` set, so every
// field stays a single source of truth and save still PUTs the full
// component (untouched blocks come straight from initialData).
//
// Pattern: triggered by an "Edit" icon button on each detail-page
// card. The dialog handles its own lock acquisition (the same hard
// edit lock the full Edit page uses), fetches the latest component
// on open, and on success refetches + closes.
//
// The trigger can be rendered inline (with `asChild`) so the parent
// card stays in control of placement and styling.

import { useEffect, useState, type ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, AlertCircle, Pencil } from "lucide-react"
import { ComponentForm, type BlockKey } from "@/components/ComponentForm"
import type { ComponentWithSha } from "@/lib/types"

const BLOCK_TITLES: Record<BlockKey, string> = {
  description: "Edit description",
  links: "Edit links",
  capabilities: "Edit capabilities",
  processes: "Edit processes",
  rules: "Edit rules & calculations",
  nfr: "Edit non-functional requirements",
  risks: "Edit risks",
}

const BLOCK_HINTS: Record<BlockKey, string> = {
  description:
    "Update the long-form narrative. Identity fields (name, owner, tags) are edited from the full Edit page.",
  links:
    "Add, remove or rename the edges from this component to its peers. Mirror links on the other side stay untouched.",
  capabilities:
    "Update which business capabilities this component owns, contributes to or consumes.",
  processes:
    "Update which business processes this component participates in.",
  rules:
    "Update formulas, rules and constraints attached to this component.",
  nfr: "Update availability, RTO/RPO, latency, throughput, classification and scaling.",
  risks: "Update the risks list.",
}

interface Props {
  componentId: string
  block: BlockKey
  onSaved?: () => void
  trigger?: ReactNode
}

export function BlockEditDialog({
  componentId,
  block,
  onSaved,
  trigger,
}: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [initialData, setInitialData] = useState<ComponentWithSha | null>(null)
  const [saving, setSaving] = useState(false)
  const formId = `block-edit-${block}-${componentId}`

  // Fetch fresh on every open so two analysts editing the same
  // component on different blocks don't collide on a stale sha.
  useEffect(() => {
    if (!open) {
      setInitialData(null)
      setLoadError(null)
      return
    }
    setLoading(true)
    setLoadError(null)
    fetch(`/api/components/${encodeURIComponent(componentId)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => null)
        if (!r.ok) {
          const msg =
            data && typeof data === "object" && "error" in data
              ? String(data.error)
              : `Request failed (${r.status})`
          throw new Error(msg)
        }
        return data as ComponentWithSha
      })
      .then(setInitialData)
      .catch((err: Error) => setLoadError(err.message || "Failed to load"))
      .finally(() => setLoading(false))
  }, [open, componentId])

  const handleSavedClose = () => {
    setOpen(false)
    onSaved?.()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm" title={BLOCK_TITLES[block]}>
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-blue-600" />
            {BLOCK_TITLES[block]}
          </DialogTitle>
          <DialogDescription>{BLOCK_HINTS[block]}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto px-6 py-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading component…
            </div>
          )}
          {!loading && loadError && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {loadError}
            </div>
          )}
          {!loading && !loadError && initialData && (
            <ComponentForm
              initialData={initialData}
              isEdit
              formId={formId}
              onSavingChange={setSaving}
              focusBlock={block}
              onSaveSuccess={handleSavedClose}
            />
          )}
        </div>

        <DialogFooter className="px-6 py-3 border-t shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={saving || loading || !initialData}
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
