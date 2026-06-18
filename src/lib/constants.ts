import {
  Cpu,
  Monitor,
  Database,
  MessageSquare,
  GitMerge,
  Globe,
  Layers,
  Package,
  Workflow,
  HardDrive,
  Clock,
  Zap,
  Box,
  Shield,
  AppWindow,
  Puzzle,
  Component as ComponentIcon,
  ServerCog,
  Table as TableIcon,
  Braces,
} from "lucide-react"
import type {
  ComponentType,
  ComponentStatus,
  CapabilityRole,
  DataKind,
  ProcessRole,
  RuleKind,
} from "./types"

export const TYPE_ICONS: Record<ComponentType, typeof Cpu> = {
  component: ComponentIcon,
  service: ServerCog,
  microservice: Cpu,
  frontend: Monitor,
  database: Database,
  table: TableIcon,
  schema: Braces,
  queue: MessageSquare,
  gateway: GitMerge,
  external: Globe,
  platform: Layers,
  library: Package,
  "data-pipeline": Workflow,
  storage: HardDrive,
  "batch-job": Clock,
  cache: Zap,
  context: Box,
  boundary: Shield,
  application: AppWindow,
  module: Puzzle,
}

export const TYPE_LABELS: Record<ComponentType, string> = {
  component: "Component",
  service: "Service",
  microservice: "Microservice",
  frontend: "Frontend",
  database: "Database",
  table: "Table",
  schema: "Schema",
  queue: "Queue",
  gateway: "Gateway",
  external: "External",
  platform: "Platform",
  library: "Library",
  "data-pipeline": "Data Pipeline",
  storage: "Storage",
  "batch-job": "Batch Job",
  cache: "Cache",
  context: "Context",
  boundary: "Boundary",
  application: "Application",
  module: "Module",
}

export const STATUS_COLORS: Record<ComponentStatus, string> = {
  draft: "bg-yellow-100 text-yellow-800 border-yellow-300",
  production: "bg-green-100 text-green-800 border-green-300",
  deprecated: "bg-gray-100 text-gray-500 border-gray-300",
}

// Order matters — "component" sits at the top so it is the default
// when the form picks `COMPONENT_TYPES[0]`.
export const COMPONENT_TYPES: ComponentType[] = [
  "component",
  "service",
  "microservice",
  "frontend",
  "database",
  "table",
  "schema",
  "cache",
  "queue",
  "data-pipeline",
  "batch-job",
  "storage",
  "gateway",
  "external",
  "platform",
  "library",
  "context",
  "boundary",
  "application",
  "module",
]

export const COMPONENT_STATUSES: ComponentStatus[] = [
  "draft",
  "production",
  "deprecated",
]

export const CONNECTOR_TYPES = [
  "rest",
  "grpc",
  "async",
  "db",
  "table",
  "file",
  "human",
  "info",
  "link",
  "data",
] as const

export const INTERFACE_DIRECTIONS = ["provides", "consumes"] as const

export const BUSINESS_CAPABILITIES = [
  "Customer Management",
  "Order Management",
  "Product Management",
  "Billing & Invoicing",
  "Payment Processing",
  "Identity & Access Management",
  "User Onboarding",
  "Notification & Messaging",
  "Reporting & Analytics",
  "Data Integration",
  "Document Management",
  "Workflow & Approval",
  "Inventory Management",
  "Shipping & Logistics",
  "Customer Support",
  "Marketing & Campaigns",
  "Compliance & Audit",
  "Risk Management",
  "Financial Accounting",
  "Human Resources",
  "Partner Management",
  "Content Management",
  "Search & Discovery",
  "Pricing & Discounts",
  "Subscription Management",
] as const

export const DATA_CLASSIFICATIONS = ["public", "internal", "confidential", "restricted"] as const

export const DATA_CLASSIFICATION_LABELS: Record<string, string> = {
  public: "Public",
  internal: "Internal",
  confidential: "Confidential",
  restricted: "Restricted",
}

export const SCALING_MODELS = ["horizontal", "vertical", "none"] as const

export const RELATIONSHIP_TYPES = [
  "parent-of",
  "child-of",
  "depends-on",
  "communicates-with",
  "reads-from",
  "writes-to",
  "fallback",
] as const

export const RELATIONSHIP_LABELS: Record<string, string> = {
  "parent-of": "Parent of",
  "child-of": "Child of",
  "depends-on": "Depends on",
  "communicates-with": "Communicates with",
  "reads-from": "Reads from",
  "writes-to": "Writes to",
  "fallback": "Fallback for",
}

// Display labels for inverse relationships — used when another
// component declares a relationship targeting THIS component, and we
// surface that as a regular row in THIS component's Relationships
// section. The original side stays the source of truth on disk; this
// mapping is presentation-only, so the analyst sees "Parent of X" on
// the parent's page when X has declared "child-of: parent". Pairs:
//
//   parent-of (X parent of me)       → me: "Child of"
//   child-of  (X child of me)        → me: "Parent of"
//   depends-on (X depends on me)     → me: "Required by"
//   communicates-with (X comm me)    → me: "Communicates with" (symmetric)
//   reads-from (X reads from me)     → me: "Read by"
//   writes-to (X writes to me)       → me: "Written to by"
//   fallback (X fallback for me)     → me: "Has fallback"
export const INVERSE_RELATIONSHIP_LABELS: Record<string, string> = {
  "parent-of": "Child of",
  "child-of": "Parent of",
  "depends-on": "Required by",
  "communicates-with": "Communicates with",
  "reads-from": "Read by",
  "writes-to": "Written to by",
  "fallback": "Has fallback",
}

// -------------------------- v2: links[] role / protocol --------------------------

import type { LinkRole, LinkProtocol } from "./types"

export const LINK_ROLES: LinkRole[] = [
  "calls",
  "serves",
  "part-of",
  "contains",
  "reads-from",
  "writes-to",
]

export const LINK_ROLE_LABELS: Record<LinkRole, string> = {
  "calls": "Calls",
  "serves": "Serves",
  "part-of": "Part of",
  "contains": "Contains",
  "reads-from": "Reads from",
  "writes-to": "Writes to",
}

/**
 * Label shown on the **target** component's detail page when this
 * component declares a link toward it. Inverse direction of the
 * declared role.
 */
export const INVERSE_LINK_ROLE_LABELS: Record<LinkRole, string> = {
  "calls": "Called by",
  "serves": "Served by",
  "part-of": "Contains",
  "contains": "Part of",
  "reads-from": "Read by",
  "writes-to": "Written to by",
}

/**
 * Mirror pair lookup. When non-undefined, the consistency check
 * expects the target to declare the inverse role pointing back at
 * the source.
 *
 *   calls       ↔ serves       — API edge declared from both sides
 *   part-of     ↔ contains     — containment declared from both sides
 *   reads-from  ↔ writes-to    — v2 data flow (Phase 2). A reads X
 *                                from B is the same edge as B writes
 *                                X to A; mirror match also requires
 *                                the `name` field to agree so the
 *                                data item identity carries through.
 */
export const LINK_ROLE_INVERSE: Partial<Record<LinkRole, LinkRole>> = {
  "calls": "serves",
  "serves": "calls",
  "part-of": "contains",
  "contains": "part-of",
  "reads-from": "writes-to",
  "writes-to": "reads-from",
}

// Reuses CONNECTOR_TYPES for the protocol enum so existing form
// pickers, drawio export, and validator entries all stay valid.
export const LINK_PROTOCOLS: LinkProtocol[] = [
  "rest",
  "grpc",
  "async",
  "db",
  "table",
  "file",
  "human",
  "info",
  "link",
  "data",
]

export const LINK_ROLE_COLORS: Record<LinkRole, string> = {
  "calls":      "bg-blue-100 text-blue-800 border-blue-300",
  "serves":     "bg-emerald-100 text-emerald-800 border-emerald-300",
  "part-of":    "bg-purple-100 text-purple-800 border-purple-300",
  "contains":   "bg-purple-100 text-purple-800 border-purple-300",
  "reads-from": "bg-amber-100 text-amber-800 border-amber-300",
  "writes-to":  "bg-rose-100 text-rose-800 border-rose-300",
}

// -------------------------- Solutions --------------------------

import type { SolutionStatus, MemberDisposition, ProcessStepKind } from "./types"

export const PROCESS_STEP_KINDS: ProcessStepKind[] = ["sync", "async", "note", "return"]

export const PROCESS_STEP_KIND_LABELS: Record<ProcessStepKind, string> = {
  sync: "Sync call",
  async: "Async",
  note: "Note / internal",
  return: "Return",
}

export const SOLUTION_STATUSES: SolutionStatus[] = [
  "draft",
  "proposed",
  "approved",
  "built",
  "retired",
]

export const SOLUTION_STATUS_COLORS: Record<SolutionStatus, string> = {
  draft: "bg-yellow-100 text-yellow-800 border-yellow-300",
  proposed: "bg-blue-100 text-blue-800 border-blue-300",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-300",
  built: "bg-green-100 text-green-800 border-green-300",
  retired: "bg-gray-100 text-gray-500 border-gray-300",
}

export const MEMBER_DISPOSITIONS: MemberDisposition[] = [
  "reuse",
  "extend",
  "new",
  "external",
]

export const MEMBER_DISPOSITION_LABELS: Record<MemberDisposition, string> = {
  reuse: "Reuse",
  extend: "Extend",
  new: "New",
  external: "External",
}

export const MEMBER_DISPOSITION_COLORS: Record<MemberDisposition, string> = {
  reuse: "bg-green-100 text-green-800 border-green-300",
  extend: "bg-amber-100 text-amber-800 border-amber-300",
  new: "bg-blue-100 text-blue-800 border-blue-300",
  external: "bg-gray-100 text-gray-600 border-gray-300",
}

export const CAPABILITY_ROLES: CapabilityRole[] = [
  "owner",
  "contributor",
  "consumer",
  "indirect",
]

export const CAPABILITY_ROLE_LABELS: Record<CapabilityRole, string> = {
  owner: "Owner",
  contributor: "Contributor",
  consumer: "Consumer",
  indirect: "Indirect",
}

export const CAPABILITY_ROLE_COLORS: Record<CapabilityRole, string> = {
  owner: "bg-blue-100 text-blue-800 border-blue-300",
  contributor: "bg-green-100 text-green-800 border-green-300",
  consumer: "bg-gray-100 text-gray-800 border-gray-300",
  indirect: "bg-amber-100 text-amber-800 border-amber-300",
}

export const FORMAT_DATA_KINDS: DataKind[] = [
  "table",
  "file",
  "stream",
  "message",
  "form",
]

export const BUSINESS_DATA_KINDS: DataKind[] = [
  "event",
  "command",
  "document",
  "decision",
  "signal",
]

export const TECHNICAL_DATA_KINDS: DataKind[] = [
  "business",
  "reference",
  "cache",
  "config",
  "transient",
  "logs",
]

// All kinds, in dropdown order (format → business → technical).
export const DATA_KINDS: DataKind[] = [
  ...FORMAT_DATA_KINDS,
  ...BUSINESS_DATA_KINDS,
  ...TECHNICAL_DATA_KINDS,
]

export const DATA_KIND_LABELS: Record<DataKind, string> = {
  // Format — the physical shape
  table: "Table",
  file: "File",
  stream: "Stream",
  message: "Message",
  form: "Form",
  // Business — the semantic meaning
  event: "Event",
  command: "Command",
  document: "Document",
  decision: "Decision",
  signal: "Signal",
  // Technical — the role in the system
  business: "Business state",
  reference: "Reference",
  cache: "Cache",
  config: "Config",
  transient: "Transient",
  logs: "Logs",
}

export const DATA_KIND_COLORS: Record<DataKind, string> = {
  // Format — neutral / structural palette
  table: "bg-slate-100 text-slate-800 border-slate-300",
  file: "bg-zinc-100 text-zinc-800 border-zinc-300",
  stream: "bg-teal-100 text-teal-800 border-teal-300",
  message: "bg-cyan-100 text-cyan-800 border-cyan-300",
  form: "bg-stone-100 text-stone-800 border-stone-300",
  // Business — warmer palette (things you can talk about)
  event: "bg-emerald-100 text-emerald-800 border-emerald-300",
  command: "bg-rose-100 text-rose-800 border-rose-300",
  document: "bg-indigo-100 text-indigo-800 border-indigo-300",
  decision: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300",
  signal: "bg-amber-100 text-amber-800 border-amber-300",
  // Technical — cooler palette (state and infra)
  business: "bg-blue-100 text-blue-800 border-blue-300",
  reference: "bg-purple-100 text-purple-800 border-purple-300",
  cache: "bg-green-100 text-green-800 border-green-300",
  config: "bg-gray-100 text-gray-800 border-gray-300",
  transient: "bg-yellow-100 text-yellow-800 border-yellow-300",
  logs: "bg-orange-100 text-orange-800 border-orange-300",
}

export const PROCESS_ROLES: ProcessRole[] = [
  "owner",
  "participant",
  "listener",
  "trigger",
]

export const PROCESS_ROLE_LABELS: Record<ProcessRole, string> = {
  owner: "Owner",
  participant: "Participant",
  listener: "Listener",
  trigger: "Trigger",
}

export const PROCESS_ROLE_COLORS: Record<ProcessRole, string> = {
  owner: "bg-blue-100 text-blue-800 border-blue-300",
  participant: "bg-green-100 text-green-800 border-green-300",
  listener: "bg-gray-100 text-gray-800 border-gray-300",
  trigger: "bg-amber-100 text-amber-800 border-amber-300",
}

export const RULE_KINDS: RuleKind[] = ["formula", "rule", "constraint"]

export const RULE_KIND_LABELS: Record<RuleKind, string> = {
  formula: "Formula",
  rule: "Rule",
  constraint: "Constraint",
}

export const RULE_KIND_COLORS: Record<RuleKind, string> = {
  formula: "bg-blue-100 text-blue-800 border-blue-300",
  rule: "bg-emerald-100 text-emerald-800 border-emerald-300",
  constraint: "bg-red-100 text-red-800 border-red-300",
}

export const RULE_KIND_HINTS: Record<RuleKind, string> = {
  formula: "A calculation or expression — e.g. total = base * (1 + rate)",
  rule: "A behavior expressed as Given / When / Then — e.g. when payment is late, cancel order",
  constraint: "An invariant that must always hold — e.g. order total must equal sum of line items",
}

// Colors matching Draw.io library export (drawio.ts typeStyles)
// Each type has: fill (very subtle bg), border (left accent), text (icon/label tint)
export const TYPE_COLORS: Record<ComponentType, { fill: string; border: string; text: string }> = {
  component:       { fill: "#eef2ff", border: "#6366f1", text: "#4338ca" },
  service:         { fill: "#cffafe", border: "#0891b2", text: "#0e7490" },
  microservice:    { fill: "#dae8fc", border: "#6c8ebf", text: "#4a6fa5" },
  frontend:        { fill: "#d5e8d4", border: "#82b366", text: "#5a8a42" },
  database:        { fill: "#fff2cc", border: "#d6b656", text: "#b8941e" },
  table:           { fill: "#fef3c7", border: "#d97706", text: "#92400e" },
  schema:          { fill: "#fce7f3", border: "#db2777", text: "#9d174d" },
  queue:           { fill: "#f8cecc", border: "#b85450", text: "#a03e3a" },
  gateway:         { fill: "#e1d5e7", border: "#9673a6", text: "#7a5a8a" },
  external:        { fill: "#f5f5f5", border: "#666666", text: "#555555" },
  platform:        { fill: "#ffe6cc", border: "#d79b00", text: "#b88400" },
  library:         { fill: "#f0f0f0", border: "#999999", text: "#777777" },
  "data-pipeline": { fill: "#d4e8f7", border: "#3a7ca5", text: "#2c6a8f" },
  storage:         { fill: "#e8dff0", border: "#7b5ea7", text: "#654b8a" },
  "batch-job":     { fill: "#fce4d6", border: "#c55a11", text: "#a84b0f" },
  cache:           { fill: "#d6f5d6", border: "#48a848", text: "#357a35" },
  context:         { fill: "#e8f4e8", border: "#2e7d32", text: "#1b5e20" },
  boundary:        { fill: "#fde8e8", border: "#c62828", text: "#b71c1c" },
  application:     { fill: "#e3f2fd", border: "#1565c0", text: "#0d47a1" },
  module:          { fill: "#f3e5f5", border: "#8e24aa", text: "#6a1b9a" },
}
