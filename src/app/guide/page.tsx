// Analyst quick-start — a friendly one-pager explaining the ideal way to
// work in the Team Repository and what each part of the repo is for.
// Linked from the top nav ("Guide"). Static, no client state.

import Link from "next/link"
import {
  Boxes,
  Component as ComponentIcon,
  Workflow,
  FileImage,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Lightbulb,
  PencilRuler,
} from "lucide-react"

export const metadata = {
  title: "Guide — Team Repository",
}

export default function GuidePage() {
  return (
    <div className="max-w-4xl mx-auto space-y-10">
      {/* hero */}
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-3 py-1">
          <Sparkles className="h-3.5 w-3.5" />
          Start here
        </div>
        <h1 className="text-3xl font-bold">Welcome to the Team Repository</h1>
        <p className="text-muted-foreground text-lg">
          One living picture of our architecture — the building blocks we have,
          and the solutions we assemble from them. Here&apos;s how to work with it.
        </p>
      </header>

      {/* the workflow */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">The ideal flow</h2>
        <div className="grid gap-3">
          <Step
            n={1}
            icon={<Boxes className="h-5 w-5" />}
            title="Start with a Solution"
            body={
              <>
                Describe what you&apos;re building — a goal and a short
                description. The tool (and AI assist) proposes which{" "}
                <strong>existing</strong> components could make it happen. You
                compose, you don&apos;t start from a blank page.
              </>
            }
          />
          <Step
            n={2}
            icon={<CheckCircle2 className="h-5 w-5" />}
            title="Check the components"
            body={
              <>
                Look at the proposed components. Do they actually do what you
                need? Mark each one <em>reuse</em> (it&apos;s fine as-is) or{" "}
                <em>extend</em> (it needs changes).
              </>
            }
          />
          <Step
            n={3}
            icon={<ComponentIcon className="h-5 w-5" />}
            title="Missing something? Create a new component"
            body={
              <>
                If a piece doesn&apos;t exist yet, add it as a{" "}
                <strong>new component</strong> — name it however makes sense to
                you. It&apos;s created as a draft for you to flesh out. Rough is
                fine; you&apos;re sketching the shape.
              </>
            }
          />
          <Step
            n={4}
            icon={<PencilRuler className="h-5 w-5" />}
            title="Put the detail on the component"
            body={
              <>
                This is the important one. A solution{" "}
                <strong>wires components together</strong> and models how they
                run a process (the Processes tab). The component-level detail —
                business logic, rules, calculations, NFRs, capabilities — lives{" "}
                <strong>on the component itself</strong>. Open the component and
                add it there (you can even import rules from a document or code
                with AI).
              </>
            }
          />
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <Lightbulb className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-900">
            <strong>Golden rule:</strong> a <em>Solution</em> says “these parts,
            wired this way.” A <em>Component</em> owns its own logic and rules.
            Keep the detail on the component and every solution that reuses it
            stays correct automatically.
          </p>
        </div>
      </section>

      {/* repo structure */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">What&apos;s in the repo — and why</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <StructureCard
            href="/"
            icon={<ComponentIcon className="h-5 w-5 text-indigo-600" />}
            title="Components"
            what="The building blocks — services, databases, frontends, queues, contexts…"
            why="Each one is the single source of truth for its links to others, its capabilities, business rules and NFRs. Everything else is built on top of these."
          />
          <StructureCard
            href="/solutions"
            icon={<Boxes className="h-5 w-5 text-blue-600" />}
            title="Solutions"
            what="A new offering composed from existing components (the “to-be”)."
            why="Pick what to reuse, fill the gaps with new components, describe how they interact — then generate a Detailed Solution Description. Components stay clean; one component can serve many solutions."
          />
          <StructureCard
            href="/processes"
            icon={<Workflow className="h-5 w-5 text-emerald-600" />}
            title="Processes"
            what="A cross-cutting index of every process modelled across solutions."
            why="A process is an editable step-by-step sequence on a solution. This page derives, for each one, its participants (with roles) and which solutions model it — great for 'what-runs-what' questions."
          />
          <StructureCard
            href="/diagrams"
            icon={<FileImage className="h-5 w-5 text-purple-600" />}
            title="Diagrams"
            what="Visual maps — the architecture overview and saved diagrams."
            why="The overview nests components by hierarchy (context ⊃ services ⊃ modules) and draws the real links between them. The picture, straight from the data."
          />
        </div>
      </section>

      {/* first 15 minutes */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Your first 15 minutes</h2>
        <ol className="space-y-2 text-sm">
          <Tick>Browse the <Link href="/" className="underline">Catalog</Link> — see what components already exist.</Tick>
          <Tick>Open one component — look at its Links, Rules and Properties tabs.</Tick>
          <Tick>Create a <Link href="/solutions/new" className="underline">new Solution</Link> for something you&apos;re working on — try <strong>Pre-fill with AI</strong>.</Tick>
          <Tick>Review the proposed components; add a new one if something&apos;s missing.</Tick>
          <Tick>Open a new/changed component and start adding its rules and logic.</Tick>
        </ol>
        <div className="flex gap-3 pt-2">
          <Link
            href="/solutions/new"
            className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
          >
            Start a solution
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Browse the catalog
          </Link>
        </div>
      </section>
    </div>
  )
}

function Step({
  n,
  icon,
  title,
  body,
}: {
  n: number
  icon: React.ReactNode
  title: string
  body: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-4 rounded-lg border p-4 bg-white">
      <div className="flex flex-col items-center shrink-0">
        <div className="flex items-center justify-center h-9 w-9 rounded-full bg-primary text-primary-foreground font-bold">
          {n}
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2 font-semibold">
          <span className="text-muted-foreground">{icon}</span>
          {title}
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
      </div>
    </div>
  )
}

function StructureCard({
  href,
  icon,
  title,
  what,
  why,
}: {
  href: string
  icon: React.ReactNode
  title: string
  what: string
  why: string
}) {
  return (
    <Link href={href} className="block rounded-lg border p-4 bg-white hover:border-foreground/30 transition-colors">
      <div className="flex items-center gap-2 font-semibold mb-1">
        {icon}
        {title}
      </div>
      <p className="text-sm text-foreground/80">{what}</p>
      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{why}</p>
    </Link>
  )
}

function Tick({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
      <span className="text-muted-foreground">{children}</span>
    </li>
  )
}
