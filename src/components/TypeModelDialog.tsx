"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { TypeIcon } from "./TypeIcon"
import { TYPE_LABELS, TYPE_COLORS } from "@/lib/constants"
import type { ComponentType } from "@/lib/types"
import { HelpCircle } from "lucide-react"

interface TypeNode {
  type: ComponentType
  label: string
  hint: string
  children?: TypeNode[]
}

// Org hierarchy — the deployment / ownership tree.
const orgHierarchy: TypeNode[] = [
  {
    type: "boundary",
    label: "Boundary",
    hint: "Security / network zone",
    children: [
      {
        type: "context",
        label: "Context",
        hint: "Business domain / bounded context",
        children: [
          {
            type: "application",
            label: "Application",
            hint: "Monolith or COTS product",
            children: [
              { type: "module", label: "Module", hint: "Logical unit inside an application" },
            ],
          },
          {
            type: "microservice",
            label: "Microservice",
            hint: "Independently deployable service",
            children: [
              { type: "module", label: "Module", hint: "Logical unit inside a service" },
            ],
          },
          {
            type: "service",
            label: "Service",
            hint: "Generic service (when not strictly a microservice)",
            children: [
              { type: "module", label: "Module", hint: "Logical unit inside a service" },
            ],
          },
        ],
      },
    ],
  },
]

// Data hierarchy — the storage tree. A Database groups Schemas (logical
// namespaces); a Schema groups Tables (or equivalent collections /
// entities). Schemas can also be used standalone to model a message
// contract (JSON / Avro / Protobuf / OpenAPI) when the storage parent
// is not relevant.
const dataHierarchy: TypeNode[] = [
  {
    type: "database",
    label: "Database",
    hint: "Persistent data store",
    children: [
      {
        type: "schema",
        label: "Schema",
        hint: "Database schema / namespace (also: message / API contract)",
        children: [
          { type: "table", label: "Table", hint: "Table / collection / entity" },
        ],
      },
    ],
  },
]

// Standalone — can attach anywhere via relationships, no required
// parent/child shape.
const standalone: { type: ComponentType; label: string; hint: string }[] = [
  { type: "component", label: "Component", hint: "Generic component (default when unsure)" },
  { type: "frontend", label: "Frontend", hint: "Web or mobile UI" },
  { type: "cache", label: "Cache", hint: "In-memory data layer" },
  { type: "queue", label: "Queue", hint: "Message broker / event bus" },
  { type: "data-pipeline", label: "Data Pipeline", hint: "ETL / streaming processing" },
  { type: "batch-job", label: "Batch Job", hint: "Scheduled processing" },
  { type: "storage", label: "Storage", hint: "Blob / file / object storage" },
  { type: "gateway", label: "Gateway", hint: "API gateway / integration point" },
  { type: "external", label: "External", hint: "Third-party system" },
  { type: "platform", label: "Platform", hint: "Shared infrastructure platform" },
  { type: "library", label: "Library", hint: "Shared code / SDK" },
]

function TypeBadge({ type, hint }: { type: ComponentType; hint: string }) {
  const colors = TYPE_COLORS[type]
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-md border-l-[3px]"
      style={{
        borderLeftColor: colors.border,
        backgroundColor: `${colors.fill}30`,
      }}
    >
      <TypeIcon type={type} style={{ color: colors.text }} className="h-4 w-4 shrink-0" />
      <span className="text-sm font-medium" style={{ color: colors.text }}>
        {TYPE_LABELS[type]}
      </span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  )
}

function TreeNode({ node, depth = 0 }: { node: TypeNode; depth?: number }) {
  return (
    <div className="relative">
      {depth > 0 && (
        <div
          className="absolute left-0 top-0 bottom-0 border-l-2 border-dashed border-gray-200"
          style={{ marginLeft: -16 }}
        />
      )}
      <TypeBadge type={node.type} hint={node.hint} />
      {node.children && (
        <div className="ml-6 mt-1.5 space-y-1.5 relative">
          {node.children.map((child, i) => (
            <div key={`${child.type}-${i}`} className="relative">
              {/* Horizontal connector line */}
              <div
                className="absolute border-t-2 border-dashed border-gray-200"
                style={{ left: -16, top: 16, width: 12 }}
              />
              <TreeNode node={child} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function TypeModelDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Component type model">
          <HelpCircle className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader className="bg-gray-50 -mx-6 -mt-6 px-6 pt-6 pb-4 rounded-t-lg">
          <DialogTitle>Component Type Model</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            How the 20 component types relate to each other
          </p>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Org hierarchy — deployment / ownership tree */}
          <div>
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-3">
              Org hierarchy — parent → child
            </h3>
            <div className="space-y-1.5">
              {orgHierarchy.map((node, i) => (
                <TreeNode key={i} node={node} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3 ml-1">
              A Boundary holds Contexts, a Context holds Applications,
              Microservices or Services, and those hold Modules.
              Microservice / Application / Service are alternative shapes
              at the same level — pick whichever matches the actual
              deployment unit.
            </p>
          </div>

          <hr />

          {/* Data hierarchy — storage tree */}
          <div>
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-3">
              Data hierarchy — parent → child
            </h3>
            <div className="space-y-1.5">
              {dataHierarchy.map((node, i) => (
                <TreeNode key={i} node={node} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3 ml-1">
              A Database groups Schemas (logical namespaces). A Schema
              groups Tables (or equivalent collections / entities). Schemas
              can also stand alone to model a message / API contract
              (JSON, Avro, Protobuf, OpenAPI) without a database parent.
            </p>
          </div>

          <hr />

          {/* Standalone types */}
          <div>
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-3">
              Standalone — can live at any level
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              {standalone.map((t) => (
                <TypeBadge key={t.type} type={t.type} hint={t.hint} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3 ml-1">
              These types are not hierarchical. They connect to other
              components via relationships like depends-on, reads-from or
              communicates-with. Component is the catch-all default when
              none of the more specific types fits.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
