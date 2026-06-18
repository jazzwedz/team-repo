"use client"

// Click-first multi-select with search + create-new. Selected values
// show on top (click to remove); the filtered list below adds on click;
// typing a value not in the list offers "+ Add". Used by the Solutions
// composer and editor for delivers (capabilities / processes).

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Plus, X } from "lucide-react"

export function ChipPicker({
  title,
  options,
  selected,
  onToggle,
  empty,
}: {
  title: string
  options: string[]
  selected: string[]
  onToggle: (v: string) => void
  empty?: string
}) {
  const [q, setQ] = useState("")
  const term = q.trim()
  const lc = term.toLowerCase()
  const available = options
    .filter((o) => !selected.includes(o))
    .filter((o) => o.toLowerCase().includes(lc))
  const exists = [...options, ...selected].some((o) => o.toLowerCase() === lc)
  const canCreate = term !== "" && !exists

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onToggle(s)}
              className="text-xs px-2.5 py-1 rounded-full border border-primary bg-primary text-primary-foreground inline-flex items-center gap-1"
            >
              {s}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 items-center">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search or type to add…"
          className="h-8 max-w-xs"
        />
        {canCreate && (
          <Button type="button" size="sm" variant="outline" onClick={() => { onToggle(term); setQ("") }}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add “{term}”
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto">
        {available.slice(0, 80).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onToggle(o)}
            className="text-xs px-2.5 py-1 rounded-full border hover:bg-muted transition-colors"
          >
            {o}
          </button>
        ))}
        {available.length === 0 && !canCreate && (
          <span className="text-xs text-muted-foreground">
            {options.length === 0 ? empty || "Nothing available — type to add." : "Type to add a new one."}
          </span>
        )}
      </div>
    </div>
  )
}
