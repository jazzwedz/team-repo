"use client"

// Agent-team DSD progress — the full pipeline at work (facts → section
// writers → critic panel → lead → library), in the tool's clean light
// black-and-white style. Animation kept (pulse, flowing dots, rail), colours
// dropped. Driven by the job phase.

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Database, PenLine, Search, Wand2, Archive, Check } from "lucide-react"
import type { ReactNode } from "react"

type Phase = "grounding" | "drafting" | "reviewing" | "revising" | "consolidating" | "saving" | "done" | string

const ORDER: Record<string, number> = {
  grounding: 0, drafting: 1, reviewing: 2, revising: 3, consolidating: 4, saving: 5, done: 6,
}

const FRIENDLY: Record<string, string> = {
  grounding: "Reading the solution and pulling the verified facts…",
  drafting: "Section writers are composing their chapters in parallel…",
  reviewing: "The critic panel is reviewing the draft from every angle…",
  revising: "Writers are resolving what the critics flagged…",
  consolidating: "The lead editor is stitching it into one document…",
  saving: "Filing it into your DSD library…",
  done: "Document delivered.",
}

export function DsdProgressModal({
  open,
  phase,
  iterations,
  lockedCount = 0,
}: {
  open: boolean
  phase: Phase
  iterations?: number
  lockedCount?: number
}) {
  const o = ORDER[phase] ?? 0
  const writersActive = phase === "drafting" || phase === "revising"
  const allDone = phase === "done"

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-2xl top-16 translate-y-0 [&>button:last-child]:hidden">
        <DialogHeader>
          <DialogTitle>Your AI team is writing the DSD</DialogTitle>
        </DialogHeader>

        <div className="mt-4 flex items-center justify-between gap-1 overflow-x-auto pb-1">
          <Node icon={<Database className="h-5 w-5" />} label="Facts" active={phase === "grounding"} done={o > 0} />
          <Link active={writersActive || o > 1} />
          <Cluster label="Writers" icon={<PenLine className="h-4 w-4" />} active={writersActive} done={o > 3} count={4} />
          <Link active={phase === "reviewing" || o > 2} />
          <Cluster label="Critics" icon={<Search className="h-4 w-4" />} active={phase === "reviewing"} done={o > 2} count={4} />
          <Link active={phase === "consolidating" || o > 4} />
          <Node icon={<Wand2 className="h-5 w-5" />} label="Lead" active={phase === "consolidating"} done={o > 4} />
          <Link active={phase === "saving" || o > 5} />
          <Node icon={<Archive className="h-5 w-5" />} label="Library" active={phase === "saving"} done={o > 5} />
        </div>

        <div className="mt-5 rounded-md border bg-muted/40 px-3 py-2 font-mono text-[13px] text-muted-foreground">
          <span className="text-foreground">›</span>{" "}
          {allDone ? "Document delivered." : FRIENDLY[phase] || "Working…"}
          {phase === "revising" && iterations ? <span className="ml-2">[pass {iterations}]</span> : null}
          <span className="dsd-cursor text-foreground">▋</span>
        </div>

        {lockedCount > 0 && (
          <div className="mt-2 text-center text-xs text-muted-foreground">
            🔒 {lockedCount} chapter{lockedCount === 1 ? "" : "s"} kept as-is (your content)
          </div>
        )}

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="dsd-rail h-full rounded-full bg-primary" />
        </div>

        <style jsx>{`
          .dsd-cursor { animation: dsd-blink 1s steps(1) infinite; }
          @keyframes dsd-blink { 50% { opacity: 0; } }
          .dsd-rail {
            width: 40%;
            animation: dsd-rail 1.6s ease-in-out infinite;
          }
          @keyframes dsd-rail {
            0% { transform: translateX(-110%); }
            100% { transform: translateX(360%); }
          }
        `}</style>
      </DialogContent>
    </Dialog>
  )
}

function nodeClass(active: boolean, done: boolean): string {
  if (active) return "border-primary bg-primary text-primary-foreground dsd-pulse"
  if (done) return "border-border bg-muted text-foreground"
  return "border-border text-muted-foreground opacity-50"
}

function Node({ icon, label, active, done }: { icon: ReactNode; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <div className={`flex h-12 w-12 items-center justify-center rounded-xl border transition-all ${nodeClass(active, done)}`}>
        {done && !active ? <Check className="h-5 w-5" /> : icon}
      </div>
      <span className={`text-[11px] font-medium ${active ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
      <style jsx>{`
        .dsd-pulse { animation: dsd-pulse 1.3s ease-in-out infinite; }
        @keyframes dsd-pulse {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-2px) scale(1.06); }
        }
      `}</style>
    </div>
  )
}

function Cluster({ label, icon, active, done, count }: { label: string; icon: ReactNode; active: boolean; done: boolean; count: number }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <div className="flex gap-1">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-all ${nodeClass(active, done)} ${active ? "dsd-pulse" : ""}`}
            style={{ animationDelay: `${i * 0.12}s` }}
          >
            {done && !active ? <Check className="h-3.5 w-3.5" /> : icon}
          </div>
        ))}
      </div>
      <span className={`text-[11px] font-medium ${active ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
      <style jsx>{`
        .dsd-pulse { animation: dsd-pulse 1.3s ease-in-out infinite; }
        @keyframes dsd-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
      `}</style>
    </div>
  )
}

function Link({ active }: { active: boolean }) {
  return (
    <div className="relative mx-0.5 h-8 min-w-[20px] flex-1 self-center">
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
      {active && (
        <div className="dsd-flow absolute inset-0 flex items-center gap-1.5 text-foreground">
          <span /> <span /> <span />
        </div>
      )}
      <style jsx>{`
        .dsd-flow span {
          width: 4px; height: 4px; border-radius: 9999px; background: currentColor; opacity: 0;
          animation: dsd-flow 1.3s linear infinite;
        }
        .dsd-flow span:nth-child(2) { animation-delay: 0.43s; }
        .dsd-flow span:nth-child(3) { animation-delay: 0.86s; }
        @keyframes dsd-flow {
          0% { opacity: 0; transform: translateX(-4px); }
          25% { opacity: 0.7; }
          75% { opacity: 0.7; }
          100% { opacity: 0; transform: translateX(20px); }
        }
      `}</style>
    </div>
  )
}
