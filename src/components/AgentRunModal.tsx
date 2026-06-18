"use client"

// Generic "agent at work" modal for the single-agent AI moments (compose,
// rules import, doc generation, process draft). Clean light black-and-white
// style matching the rest of the tool; animation kept (pulse, flowing dots,
// indeterminate rail). Parent closes it when the call resolves.

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export interface AgentRunNode {
  label: string
  /** Emoji glyph for the node face. */
  icon: string
}

export function AgentRunModal({
  open,
  title,
  nodes,
  stages,
}: {
  open: boolean
  title: string
  nodes: AgentRunNode[]
  stages: string[]
}) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!open) {
      setTick(0)
      return
    }
    const t = setInterval(() => setTick((x) => x + 1), 1400)
    return () => clearInterval(t)
  }, [open])

  const stage = stages.length ? stages[tick % stages.length] : "Working…"
  const activeNode = nodes.length > 1 ? tick % nodes.length : 0

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-xl top-16 translate-y-0 [&>button:last-child]:hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="mt-4 flex items-center justify-center gap-1">
          <Chip glyph="↧" label="Context" />
          <Link />
          {nodes.map((n, i) => (
            <div key={i} className="flex items-center">
              <AgentDot icon={n.icon} label={n.label} active={i === activeNode} />
              {i < nodes.length - 1 && <Link />}
            </div>
          ))}
          <Link />
          <Chip glyph="↦" label="Output" />
        </div>

        <div className="mt-5 rounded-md border bg-muted/40 px-3 py-2 font-mono text-[13px] text-muted-foreground">
          <span className="text-foreground">›</span> {stage}
          <span className="ar-cursor text-foreground">▋</span>
        </div>

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="ar-rail h-full rounded-full bg-primary" />
        </div>

        <style jsx>{`
          .ar-cursor { animation: ar-blink 1s steps(1) infinite; }
          @keyframes ar-blink { 50% { opacity: 0; } }
          .ar-rail { width: 40%; animation: ar-rail 1.6s ease-in-out infinite; }
          @keyframes ar-rail {
            0% { transform: translateX(-110%); }
            100% { transform: translateX(360%); }
          }
        `}</style>
      </DialogContent>
    </Dialog>
  )
}

function AgentDot({ icon, label, active }: { icon: string; label: string; active: boolean }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <div
        className={`flex h-14 w-14 items-center justify-center rounded-xl border text-xl transition-all ${
          active ? "border-primary bg-primary text-primary-foreground ar-pulse" : "border-border text-muted-foreground opacity-50"
        }`}
      >
        {icon}
      </div>
      <span className={`max-w-[100px] truncate text-[11px] font-medium ${active ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
      <style jsx>{`
        .ar-pulse { animation: ar-pulse 1.3s ease-in-out infinite; }
        @keyframes ar-pulse {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-2px) scale(1.06); }
        }
      `}</style>
    </div>
  )
}

function Chip({ glyph, label }: { glyph: string; label: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5 opacity-60">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border text-base text-muted-foreground">{glyph}</div>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  )
}

function Link() {
  return (
    <div className="relative mx-1 h-7 w-7 self-center">
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
      <div className="ar-flow absolute inset-0 flex items-center gap-1.5 text-foreground">
        <span /> <span /> <span />
      </div>
      <style jsx>{`
        .ar-flow span {
          width: 4px; height: 4px; border-radius: 9999px; background: currentColor; opacity: 0;
          animation: ar-flow 1.3s linear infinite;
        }
        .ar-flow span:nth-child(2) { animation-delay: 0.43s; }
        .ar-flow span:nth-child(3) { animation-delay: 0.86s; }
        @keyframes ar-flow {
          0% { opacity: 0; transform: translateX(-3px); }
          25% { opacity: 0.7; }
          75% { opacity: 0.7; }
          100% { opacity: 0; transform: translateX(18px); }
        }
      `}</style>
    </div>
  )
}
