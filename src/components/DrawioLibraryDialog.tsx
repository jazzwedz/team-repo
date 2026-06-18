"use client"

// Draw.io custom library export — single source of truth.
//
// Replaces both the standalone `/export` page and the
// `Download Draw.io Library` button that used to live on the catalog
// header. Mounted on the Diagrams page header (where users actually
// reach for it) and on the component Documentation tab (alongside the
// other export / copy actions).

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Download, FileBox } from "lucide-react"

interface Props {
  /** Optional override — defaults to "Draw.io library". */
  label?: string
  variant?: "default" | "outline" | "ghost"
  size?: "default" | "sm" | "lg" | "icon"
}

export function DrawioLibraryDialog({
  label = "Draw.io library",
  variant = "outline",
  size = "default",
}: Props) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant={variant} size={size}>
          <FileBox className="h-4 w-4 mr-2" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileBox className="h-5 w-5 text-blue-600" />
            Export catalog as Draw.io library
          </DialogTitle>
          <DialogDescription>
            Use every component in the catalog as a custom library in
            Draw.io — drag any node onto a diagram and the metadata
            travels with it.
          </DialogDescription>
        </DialogHeader>

        <ol className="list-decimal list-inside space-y-2 text-sm">
          <li>
            Click <strong>Download arch-components.xml</strong> below.
          </li>
          <li>
            In Draw.io, open <strong>Extras → Edit Diagram Libraries → Import</strong>.
          </li>
          <li>
            Select the downloaded <code className="font-mono text-xs">arch-components.xml</code> file.
          </li>
          <li>
            The components appear in the left panel as a{" "}
            <strong>Custom Library</strong>.
          </li>
          <li>
            When the catalog changes, download again and re-import to
            refresh.
          </li>
        </ol>

        <div className="pt-2 flex items-center justify-end">
          <a href="/api/export/drawio" download="arch-components.xml">
            <Button>
              <Download className="h-4 w-4 mr-2" />
              Download arch-components.xml
            </Button>
          </a>
        </div>
      </DialogContent>
    </Dialog>
  )
}
