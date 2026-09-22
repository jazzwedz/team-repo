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
  FileText,
  Bot,
  Settings,
  Share2,
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
          One living, versioned picture of our architecture — the building blocks
          we have, the solutions we assemble from them, and the documentation that
          comes out of it. Here&apos;s how to work with it.
        </p>
      </header>

      {/* the model */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">How the pieces relate</h2>
        <p className="text-sm text-muted-foreground">
          <strong>Components</strong> are the building blocks and are linked to
          each other directly (calls, reads-from, writes-to, part-of…). A{" "}
          <strong>Solution</strong> doesn&apos;t own components — it{" "}
          <em>uses</em> them, marking each one as new, reuse, extend or external.
          The same component can serve many solutions.
        </p>
        <div className="rounded-lg border bg-white p-3">
          <RelationshipDiagram />
        </div>
        <ul className="grid gap-2 sm:grid-cols-3 text-xs text-muted-foreground">
          <li className="rounded-md border p-2.5 bg-white">
            <strong className="text-foreground">Membership</strong> (dashed) — the
            solution uses the component, with a disposition: new, reuse, extend or
            external.
          </li>
          <li className="rounded-md border p-2.5 bg-white">
            <strong className="text-foreground">Links</strong> (solid) — how
            components talk to each other. They live on the component, so every
            solution sees the same wiring.
          </li>
          <li className="rounded-md border p-2.5 bg-white">
            <strong className="text-foreground">Shared components</strong> — here
            Customer Service and Customer DB serve both solutions. Improve them
            once, both benefit.
          </li>
        </ul>
      </section>

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
                Give it a name — optionally a goal, description or an uploaded
                source document (BRD). <strong>Pre-fill with AI</strong> proposes
                the goal, the capabilities it delivers and which{" "}
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
                Do the proposed components actually do what you need? Mark each
                one <em>reuse</em> (fine as-is), <em>extend</em> (needs changes) or{" "}
                <em>external</em>. Missing a piece? Add it as a{" "}
                <strong>new component</strong> — it&apos;s created as a draft.
              </>
            }
          />
          <Step
            n={3}
            icon={<Workflow className="h-5 w-5" />}
            title="Wire the flows and model the process"
            body={
              <>
                Accept the existing links between members, add proposed flows, and
                describe how the solution runs a process step by step (actor →
                target). <strong>AI draft</strong> routes each step to the
                component that carries it. The Review step shows a summary with
                both the architecture and the sequence diagram.
              </>
            }
          />
          <Step
            n={4}
            icon={<PencilRuler className="h-5 w-5" />}
            title="Put the detail on the component"
            body={
              <>
                This is the important one. Business logic, rules, calculations,
                NFRs and capabilities live <strong>on the component itself</strong>.
                Use <strong>Import rules</strong> to extract them with AI from a
                PDF, an Excel (.xlsx) sheet, a Confluence page or source code — the
                documents you import from are kept with the component.
              </>
            }
          />
          <Step
            n={5}
            icon={<FileText className="h-5 w-5" />}
            title="Generate the DSD"
            body={
              <>
                On the solution, <strong>Generate DSD</strong> — a team of AI
                writers, critics and a lead produces a Detailed Solution
                Description grounded in the catalog, your source documents and
                (optionally) the real source code. Review it, give feedback, and{" "}
                <strong>publish it to Confluence</strong> with its diagrams.
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
            title="Catalog (Components)"
            what="The building blocks — services, databases, frontends, queues, contexts…"
            why="Each one is the single source of truth for its links, capabilities, business rules and NFRs, optionally mapped to its source code. Tabs: Overview, Properties, Rules & Calculations, Blast Radius, Documentation, Diagrams, History."
          />
          <StructureCard
            href="/solutions"
            icon={<Boxes className="h-5 w-5 text-blue-600" />}
            title="Solutions"
            what="A new offering composed from existing components (the “to-be”)."
            why="Members with dispositions, flows, process sequences and stored source documents — plus the DSD library generated from them and their Confluence pages."
          />
          <StructureCard
            href="/processes"
            icon={<Workflow className="h-5 w-5 text-emerald-600" />}
            title="Processes"
            what="A cross-cutting index of every process modelled across solutions."
            why="For each process: its participants (with roles) and which solutions model it — great for 'what-runs-what' questions."
          />
          <StructureCard
            href="/diagrams"
            icon={<FileImage className="h-5 w-5 text-purple-600" />}
            title="Diagrams"
            what="Visual maps — the architecture overview and saved diagrams."
            why="The overview nests components by hierarchy (context ⊃ services ⊃ modules) and draws the real links between them. The picture, straight from the data."
          />
          <StructureCard
            href="/agents"
            icon={<Bot className="h-5 w-5 text-rose-600" />}
            title="Agents"
            what="The AI team behind the tool — DSD writers, critics, lead and the assistants."
            why="Every agent is trainable: your ratings and corrections feed a coach that proposes prompt improvements you approve."
          />
          <StructureCard
            href="/settings"
            icon={<Settings className="h-5 w-5 text-slate-600" />}
            title="Settings"
            what="Health Checks · DSD Output · UI Configuration · Application Settings."
            why="Test the connections, fine-tune which chapters the DSD contains, hide blocks you don't use, and manage the app configuration (secrets stay masked and local)."
          />
        </div>
      </section>

      {/* AI helpers */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">AI helpers along the way</h2>
        <p className="text-sm text-muted-foreground">
          AI always proposes — you review and approve. Nothing is written until
          you say so.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 text-sm">
          <Helper title="Solution pre-fill" body="Goal, capabilities, members and flows from a name or a BRD." />
          <Helper title="Process draft" body="A step-by-step sequence routed through the components that carry each step." />
          <Helper title="Rules import" body="Rules and calculations from PDF, Excel, Confluence or code — at fine granularity." />
          <Helper title="Catalog Curator" body="Reads a document and proposes grounded, page-cited updates to existing components." />
          <Helper title="Consistency check" body="Finds missing links between components (AI or deterministic)." />
          <Helper title="Code awareness" body="Maps components to source files and compares documented rules with what the code does." />
          <Helper title="DSD generation" body="An agent team writes, critiques and consolidates the Detailed Solution Description." />
          <Helper title="Confluence sync" body="Publish components and DSDs; pull edits back as field-level proposals." />
        </div>
      </section>

      {/* first 15 minutes */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Your first 15 minutes</h2>
        <ol className="space-y-2 text-sm">
          <Tick>Browse the <Link href="/" className="underline">Catalog</Link> — see what components already exist.</Tick>
          <Tick>Open one component — look at its Overview, Properties and Rules &amp; Calculations tabs.</Tick>
          <Tick>Create a <Link href="/solutions/new" className="underline">new Solution</Link> for something you&apos;re working on — try <strong>Pre-fill with AI</strong>.</Tick>
          <Tick>Review the proposed components; add a new one if something&apos;s missing, then model the main process.</Tick>
          <Tick>Open a new or changed component and import its rules from a document.</Tick>
          <Tick>Back on the solution, generate the DSD and publish it to Confluence.</Tick>
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

// ---------------------------------------------------------------------------
// Relationship diagram — two example solutions (top) using components (row),
// which are linked to each other (arcs below). Static inline SVG with
// generic example names.
// ---------------------------------------------------------------------------

const COMPONENTS = [
  { id: "portal", name: "Web Portal", type: "frontend", x: 16 },
  { id: "cust", name: "Customer Service", type: "service", x: 140 },
  { id: "notif", name: "Notification Service", type: "service", x: 264 },
  { id: "db", name: "Customer DB", type: "database", x: 388 },
  { id: "billing", name: "Billing Service", type: "service", x: 512 },
  { id: "pay", name: "Payment Gateway", type: "external", x: 636 },
]
const BOX_W = 110
const ROW_Y = 200
const SHARED = new Set(["cust", "db"])
const cx = (id: string) => COMPONENTS.find((c) => c.id === id)!.x + BOX_W / 2

const SOLUTIONS: { name: string; x: number; color: string; members: [string, string][] }[] = [
  {
    name: "Customer Self-Service",
    x: 60,
    color: "#2563eb",
    members: [
      ["portal", "new"],
      ["cust", "extend"],
      ["notif", "reuse"],
      ["db", "reuse"],
    ],
  },
  {
    name: "Billing Revamp",
    x: 430,
    color: "#7c3aed",
    members: [
      ["cust", "reuse"],
      ["db", "reuse"],
      ["billing", "new"],
      ["pay", "external"],
    ],
  },
]

// [from-x, to-x, control-point y, label]
const LINKS: [number, number, number, string][] = [
  [cx("portal") + 4, cx("cust") - 10, 320, "calls · rest"],
  [cx("cust") + 10, cx("notif") - 4, 320, "calls · async"],
  [cx("cust"), cx("db") - 10, 440, "reads-from · db"],
  [cx("billing") - 4, cx("db") + 10, 320, "writes-to · db"],
  [cx("billing") + 10, cx("pay") - 4, 320, "calls · rest"],
]

function RelationshipDiagram() {
  const solW = 270
  return (
    <svg
      viewBox="0 0 760 420"
      className="w-full h-auto"
      role="img"
      aria-label="Two solutions using shared components, and components linked to each other"
      fontFamily="ui-sans-serif, system-ui, sans-serif"
    >
      <defs>
        <marker id="g-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#475569" />
        </marker>
      </defs>

      {/* membership lines */}
      {SOLUTIONS.map((s) =>
        s.members.map(([cid, disp]) => {
          const x1 = s.x + solW / 2
          const y1 = 76
          const x2 = cx(cid)
          const y2 = ROW_Y
          const mx = (x1 + x2) / 2
          const my = (y1 + y2) / 2
          return (
            <g key={`${s.name}-${cid}`}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={s.color} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.75} />
              <rect x={mx - 25} y={my - 9} width={50} height={17} rx={8} fill="white" stroke={s.color} strokeWidth={1} />
              <text x={mx} y={my + 3.5} textAnchor="middle" fontSize={10} fill={s.color} fontWeight={600}>
                {disp}
              </text>
            </g>
          )
        })
      )}

      {/* solutions */}
      {SOLUTIONS.map((s) => (
        <g key={s.name}>
          <rect x={s.x} y={20} width={solW} height={56} rx={10} fill={s.color} fillOpacity={0.08} stroke={s.color} strokeWidth={1.5} />
          <text x={s.x + 14} y={42} fontSize={10} fill={s.color} fontWeight={700} letterSpacing={0.6}>
            SOLUTION
          </text>
          <text x={s.x + 14} y={62} fontSize={14} fill="#0f172a" fontWeight={600}>
            {s.name}
          </text>
        </g>
      ))}

      {/* component-to-component links (arcs below the row) */}
      {LINKS.map(([x1, x2, ctrl, label], i) => {
        const y = ROW_Y + 50
        const mid = (x1 + x2) / 2
        const bottom = (y + 2 * ctrl + y) / 4
        return (
          <g key={i}>
            <path d={`M${x1},${y} Q${mid},${ctrl} ${x2},${y}`} fill="none" stroke="#475569" strokeWidth={1.5} markerEnd="url(#g-arrow)" />
            <text x={mid} y={bottom + 14} textAnchor="middle" fontSize={10} fill="#475569">
              {label}
            </text>
          </g>
        )
      })}

      {/* components */}
      {COMPONENTS.map((c) => {
        const shared = SHARED.has(c.id)
        return (
          <g key={c.id}>
            <rect x={c.x} y={ROW_Y} width={BOX_W} height={50} rx={8} fill="white" stroke={shared ? "#0f172a" : "#94a3b8"} strokeWidth={shared ? 2 : 1.2} />
            <text x={c.x + BOX_W / 2} y={ROW_Y + 21} textAnchor="middle" fontSize={11} fill="#0f172a" fontWeight={600}>
              {c.name}
            </text>
            <text x={c.x + BOX_W / 2} y={ROW_Y + 37} textAnchor="middle" fontSize={10} fill="#64748b">
              {c.type}
            </text>
          </g>
        )
      })}

      {/* legend */}
      <g fontSize={10} fill="#475569">
        <line x1={20} y1={405} x2={48} y2={405} stroke="#2563eb" strokeWidth={1.5} strokeDasharray="5 4" />
        <text x={54} y={408}>solution uses component (disposition)</text>
        <line x1={280} y1={405} x2={308} y2={405} stroke="#475569" strokeWidth={1.5} markerEnd="url(#g-arrow)" />
        <text x={316} y={408}>link between components (role · protocol)</text>
        <rect x={560} y={398} width={22} height={14} rx={3} fill="white" stroke="#0f172a" strokeWidth={2} />
        <text x={588} y={408}>shared by both solutions</text>
      </g>
    </svg>
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

function Helper({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border p-3 bg-white flex items-start gap-2">
      <Share2 className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{body}</div>
      </div>
    </div>
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
