"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TypeIcon } from "@/components/TypeIcon"
import {
  TYPE_LABELS,
  TYPE_COLORS,
  COMPONENT_TYPES,
  CONNECTOR_TYPES,
} from "@/lib/constants"
import type { Component, ComponentType } from "@/lib/types"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  ArrowLeft,
  Download,
  Save,
  Trash2,
  Search,
  ZoomIn,
  ZoomOut,
  Maximize2,
  GripVertical,
  MousePointer2,
  Spline,
  FolderOpen,
  FileImage,
  Upload,
} from "lucide-react"
import Link from "next/link"
import type { DiagramWithSha } from "@/lib/types"

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CanvasNode {
  id: string
  componentId: string
  name: string
  type: ComponentType
  x: number
  y: number
}

type ConnectorType = (typeof CONNECTOR_TYPES)[number]

interface CanvasEdge {
  id: string
  sourceId: string
  targetId: string
  connector: ConnectorType
  label: string
}

type ToolMode = "select" | "connect"

/* ------------------------------------------------------------------ */
/*  Connector visual config                                            */
/* ------------------------------------------------------------------ */

const CONNECTOR_COLORS: Record<ConnectorType, string> = {
  rest: "#6c8ebf",
  grpc: "#9673a6",
  async: "#b85450",
  db: "#d6b656",
  table: "#d97706",
  file: "#999999",
  human: "#d79b00",
  info: "#2196f3",
  link: "#607d8b",
  data: "#db2777",
}

const CONNECTOR_LABELS: Record<ConnectorType, string> = {
  rest: "REST",
  grpc: "gRPC",
  async: "Async",
  db: "DB",
  table: "Table",
  file: "File",
  human: "Human",
  info: "Info",
  link: "Link",
  data: "Data",
}

const CONNECTOR_DASH: Record<ConnectorType, string> = {
  rest: "",
  grpc: "",
  async: "6,4",
  db: "",
  table: "",
  file: "6,4",
  human: "6,4",
  info: "",
  link: "",
  data: "",
}

/** Connectors without arrowhead (non-directional) */
const CONNECTOR_NO_ARROW = new Set<ConnectorType>(["link"])

/* ------------------------------------------------------------------ */
/*  Draw.io export styles (mirrors drawio.ts)                          */
/* ------------------------------------------------------------------ */

const typeStyles: Record<ComponentType, string> = {
  component:       "rounded=1;fillColor=#eef2ff;strokeColor=#6366f1;fontStyle=1;fontSize=11;",
  service:         "rounded=1;fillColor=#cffafe;strokeColor=#0891b2;fontStyle=1;fontSize=11;",
  microservice:    "rounded=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontStyle=1;fontSize=11;",
  frontend:        "rounded=1;fillColor=#d5e8d4;strokeColor=#82b366;fontStyle=1;fontSize=11;",
  database:        "shape=cylinder3;fillColor=#fff2cc;strokeColor=#d6b656;fontStyle=1;fontSize=11;",
  table:           "rounded=0;fillColor=#fef3c7;strokeColor=#d97706;fontStyle=1;fontSize=11;",
  schema:          "rounded=0;fillColor=#fce7f3;strokeColor=#db2777;fontStyle=1;fontSize=11;dashed=1;",
  queue:           "rounded=1;fillColor=#f8cecc;strokeColor=#b85450;fontStyle=1;fontSize=11;",
  gateway:         "rhombus;fillColor=#e1d5e7;strokeColor=#9673a6;fontStyle=1;fontSize=11;",
  external:        "rounded=1;fillColor=#f5f5f5;strokeColor=#666666;fontStyle=1;fontSize=11;dashed=1;",
  platform:        "rounded=1;fillColor=#ffe6cc;strokeColor=#d79b00;fontStyle=1;fontSize=11;",
  library:         "rounded=1;fillColor=#f0f0f0;strokeColor=#999999;fontStyle=1;fontSize=11;",
  "data-pipeline": "rounded=1;fillColor=#d4e8f7;strokeColor=#3a7ca5;fontStyle=1;fontSize=11;",
  storage:         "shape=cylinder3;fillColor=#e8dff0;strokeColor=#7b5ea7;fontStyle=1;fontSize=11;",
  "batch-job":     "rounded=1;fillColor=#fce4d6;strokeColor=#c55a11;fontStyle=1;fontSize=11;dashed=1;",
  cache:           "rounded=1;fillColor=#d6f5d6;strokeColor=#48a848;fontStyle=1;fontSize=11;",
  context:         "rounded=1;fillColor=#e8f4e8;strokeColor=#2e7d32;fontStyle=1;fontSize=11;dashed=1;strokeWidth=2;",
  boundary:        "rounded=1;fillColor=#fde8e8;strokeColor=#c62828;fontStyle=1;fontSize=11;strokeWidth=2;",
  application:     "rounded=1;fillColor=#e3f2fd;strokeColor=#1565c0;fontStyle=1;fontSize=11;strokeWidth=2;",
  module:          "rounded=1;fillColor=#f3e5f5;strokeColor=#8e24aa;fontStyle=1;fontSize=11;",
}

const typeSizes: Record<ComponentType, { w: number; h: number }> = {
  component:       { w: 120, h: 60 },
  service:         { w: 120, h: 60 },
  microservice:    { w: 120, h: 60 },
  frontend:        { w: 120, h: 60 },
  gateway:         { w: 120, h: 60 },
  database:        { w: 60,  h: 70 },
  table:           { w: 100, h: 60 },
  schema:          { w: 110, h: 60 },
  queue:           { w: 60,  h: 60 },
  external:        { w: 120, h: 60 },
  platform:        { w: 120, h: 60 },
  library:         { w: 120, h: 60 },
  "data-pipeline": { w: 140, h: 60 },
  storage:         { w: 60,  h: 70 },
  "batch-job":     { w: 120, h: 60 },
  cache:           { w: 60,  h: 60 },
  context:         { w: 160, h: 80 },
  boundary:        { w: 160, h: 80 },
  application:     { w: 140, h: 70 },
  module:          { w: 100, h: 50 },
}

/* ------------------------------------------------------------------ */
/*  Draw.io edge styles                                                */
/* ------------------------------------------------------------------ */

const edgeDrawioStyles: Record<ConnectorType, string> = {
  rest:  "endArrow=block;endFill=1;strokeColor=#6c8ebf;fontSize=10;",
  grpc:  "endArrow=block;endFill=1;strokeColor=#9673a6;fontSize=10;",
  async: "endArrow=block;endFill=0;dashed=1;strokeColor=#b85450;fontSize=10;",
  db:    "endArrow=ERmany;endFill=0;strokeColor=#d6b656;fontSize=10;",
  table: "endArrow=ERmany;endFill=0;strokeColor=#d97706;fontSize=10;",
  file:  "endArrow=open;endFill=0;dashed=1;strokeColor=#999999;fontSize=10;",
  human: "endArrow=open;endFill=0;dashed=1;strokeColor=#d79b00;fontSize=10;",
  info:  "endArrow=block;endFill=1;strokeColor=#2196f3;strokeWidth=2;fontSize=10;",
  link:  "endArrow=none;strokeColor=#607d8b;fontSize=10;",
  data:  "endArrow=block;endFill=1;strokeColor=#db2777;strokeWidth=2;fontSize=10;",
}

/* ------------------------------------------------------------------ */
/*  Generate .drawio XML                                               */
/* ------------------------------------------------------------------ */

function generateDrawioXml(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  diagramName: string
): string {
  let cellId = 2

  // Map node.id → drawio cell id
  const nodeIdMap = new Map<string, number>()

  const nodeCells = nodes.map((node) => {
    const id = cellId++
    nodeIdMap.set(node.id, id)
    const size = typeSizes[node.type]
    const style = typeStyles[node.type]
    return (
      `<UserObject label="${escapeXmlAttr(node.name)}" arch_id="${escapeXmlAttr(node.componentId)}" arch_type="${node.type}" id="${id}">` +
      `<mxCell style="${style}" vertex="1" parent="1">` +
      `<mxGeometry x="${node.x}" y="${node.y}" width="${size.w}" height="${size.h}" as="geometry"/>` +
      `</mxCell></UserObject>`
    )
  })

  const edgeCells = edges
    .filter((e) => nodeIdMap.has(e.sourceId) && nodeIdMap.has(e.targetId))
    .map((edge) => {
      const id = cellId++
      const srcId = nodeIdMap.get(edge.sourceId)!
      const tgtId = nodeIdMap.get(edge.targetId)!
      const style = edgeDrawioStyles[edge.connector]
      const label = edge.label || CONNECTOR_LABELS[edge.connector]
      return (
        `<mxCell id="${id}" value="${escapeXmlAttr(label)}" style="${style}" edge="1" parent="1" source="${srcId}" target="${tgtId}" connector_type="${edge.connector}">` +
        `<mxGeometry relative="1" as="geometry"/>` +
        `</mxCell>`
      )
    })

  const allCells = [...nodeCells, ...edgeCells]

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<mxfile host="arch-tool" modified="${new Date().toISOString()}" type="device">\n` +
    `  <diagram id="diagram-1" name="${escapeXmlAttr(diagramName)}">\n` +
    `    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="900">\n` +
    `      <root>\n` +
    `        <mxCell id="0"/>\n` +
    `        <mxCell id="1" parent="0"/>\n` +
    `        ${allCells.join("\n        ")}\n` +
    `      </root>\n` +
    `    </mxGraphModel>\n` +
    `  </diagram>\n` +
    `</mxfile>`
  )
}

function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/* ------------------------------------------------------------------ */
/*  Parse .drawio XML → nodes + edges                                  */
/* ------------------------------------------------------------------ */

const VALID_TYPES = new Set<string>(COMPONENT_TYPES)
const VALID_CONNECTORS = new Set<string>(CONNECTOR_TYPES)

function parseDrawioXml(
  xml: string
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, "application/xml")

  const nodes: CanvasNode[] = []
  const edges: CanvasEdge[] = []

  // Map drawio cell id → our node id (for edge resolution)
  const cellToNodeId = new Map<string, string>()

  // Parse nodes: UserObject elements with arch_id + arch_type
  const userObjects = Array.from(doc.querySelectorAll("UserObject"))
  for (const uo of userObjects) {
    const archId = uo.getAttribute("arch_id")
    const archType = uo.getAttribute("arch_type")
    const label = uo.getAttribute("label") || archId || "Unknown"
    const cellId = uo.getAttribute("id")

    if (!archId || !archType || !VALID_TYPES.has(archType)) continue

    const cell = uo.querySelector("mxCell[vertex]")
    const geo = cell?.querySelector("mxGeometry")

    const x = parseFloat(geo?.getAttribute("x") || "0")
    const y = parseFloat(geo?.getAttribute("y") || "0")

    const nodeId = `${archId}-${cellId || Date.now()}`
    nodes.push({
      id: nodeId,
      componentId: archId,
      name: label,
      type: archType as ComponentType,
      x: Math.round(x / 10) * 10,
      y: Math.round(y / 10) * 10,
    })

    if (cellId) cellToNodeId.set(cellId, nodeId)
  }

  // Also try plain mxCell vertices that have arch_id/arch_type (alternative format)
  const allCells = Array.from(doc.querySelectorAll("mxCell[vertex]"))
  for (const cell of allCells) {
    // Skip if already handled as child of UserObject
    if (cell.parentElement?.tagName === "UserObject") continue

    const archId = cell.getAttribute("arch_id")
    const archType = cell.getAttribute("arch_type")
    if (!archId || !archType || !VALID_TYPES.has(archType)) continue

    const label = cell.getAttribute("value") || archId
    const cellId = cell.getAttribute("id")
    const geo = cell.querySelector("mxGeometry")
    const x = parseFloat(geo?.getAttribute("x") || "0")
    const y = parseFloat(geo?.getAttribute("y") || "0")

    const nodeId = `${archId}-${cellId || Date.now()}`
    nodes.push({
      id: nodeId,
      componentId: archId,
      name: label,
      type: archType as ComponentType,
      x: Math.round(x / 10) * 10,
      y: Math.round(y / 10) * 10,
    })

    if (cellId) cellToNodeId.set(cellId, nodeId)
  }

  // Parse edges: mxCell with edge="1" and source/target
  const edgeCells = Array.from(doc.querySelectorAll("mxCell[edge]"))
  for (const cell of edgeCells) {
    const srcCellId = cell.getAttribute("source")
    const tgtCellId = cell.getAttribute("target")
    if (!srcCellId || !tgtCellId) continue

    const srcNodeId = cellToNodeId.get(srcCellId)
    const tgtNodeId = cellToNodeId.get(tgtCellId)
    if (!srcNodeId || !tgtNodeId) continue

    // Determine connector type from attribute or style
    let ct: ConnectorType = "rest"
    const connAttr = cell.getAttribute("connector_type")
    if (connAttr && VALID_CONNECTORS.has(connAttr)) {
      ct = connAttr as ConnectorType
    } else {
      // Try to infer from style
      const style = cell.getAttribute("style") || ""
      if (style.includes("dashed=1") && style.includes("#b85450")) ct = "async"
      else if (style.includes("#9673a6")) ct = "grpc"
      else if (style.includes("ERmany") || style.includes("#d6b656")) ct = "db"
      else if (style.includes("#999999")) ct = "file"
      else if (style.includes("#d79b00")) ct = "human"
    }

    const label = cell.getAttribute("value") || CONNECTOR_LABELS[ct]

    edges.push({
      id: `edge-${cell.getAttribute("id") || Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sourceId: srcNodeId,
      targetId: tgtNodeId,
      connector: ct,
      label,
    })
  }

  return { nodes, edges }
}

/* ------------------------------------------------------------------ */
/*  Helpers: center point of a node                                    */
/* ------------------------------------------------------------------ */

function nodeCenter(node: CanvasNode): { cx: number; cy: number } {
  const size = typeSizes[node.type]
  return { cx: node.x + size.w / 2, cy: node.y + size.h / 2 }
}

/** Compute intersection of a line from center to the edge of the rect */
function edgeIntersection(
  cx: number,
  cy: number,
  targetX: number,
  targetY: number,
  w: number,
  h: number
): { x: number; y: number } {
  const dx = targetX - cx
  const dy = targetY - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }

  const hw = w / 2
  const hh = h / 2

  // Scale factors for hitting each edge
  const scaleX = dx !== 0 ? hw / Math.abs(dx) : Infinity
  const scaleY = dy !== 0 ? hh / Math.abs(dy) : Infinity
  const scale = Math.min(scaleX, scaleY)

  return { x: cx + dx * scale, y: cy + dy * scale }
}

/* ------------------------------------------------------------------ */
/*  Canvas component tile                                              */
/* ------------------------------------------------------------------ */

function CanvasTile({
  node,
  selected,
  connectSource,
  toolMode,
  onMouseDown,
  onClick,
}: {
  node: CanvasNode
  selected: boolean
  connectSource: boolean
  toolMode: ToolMode
  onMouseDown: (e: React.MouseEvent, nodeId: string) => void
  onClick: (e: React.MouseEvent, nodeId: string) => void
}) {
  const colors = TYPE_COLORS[node.type]
  const size = typeSizes[node.type]
  return (
    <div
      className={`absolute select-none group ${toolMode === "connect" ? "cursor-crosshair" : "cursor-move"}`}
      style={{
        left: node.x,
        top: node.y,
        width: size.w,
        height: size.h,
        zIndex: 10,
      }}
      onMouseDown={(e) => {
        e.stopPropagation()
        if (toolMode === "select") {
          onMouseDown(e, node.id)
        }
      }}
      onClick={(e) => {
        e.stopPropagation()
        onClick(e, node.id)
      }}
    >
      <div
        className={`w-full h-full rounded-md border-2 flex flex-col items-center justify-center gap-0.5 text-center px-1 transition-shadow ${
          selected
            ? "ring-2 ring-blue-500 ring-offset-1 shadow-lg"
            : connectSource
              ? "ring-2 ring-orange-400 ring-offset-1 shadow-lg"
              : "shadow-sm hover:shadow-md"
        }`}
        style={{
          borderColor: colors.border,
          backgroundColor: colors.fill,
        }}
      >
        <TypeIcon
          type={node.type}
          className="h-4 w-4 shrink-0"
          style={{ color: colors.text }}
        />
        <span
          className="text-[10px] font-bold leading-tight truncate w-full"
          style={{ color: colors.text }}
        >
          {node.name}
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  SVG Edge renderer                                                  */
/* ------------------------------------------------------------------ */

function EdgeArrow({
  edge,
  sourceNode,
  targetNode,
  selected,
  onClick,
}: {
  edge: CanvasEdge
  sourceNode: CanvasNode
  targetNode: CanvasNode
  selected: boolean
  onClick: (edgeId: string) => void
}) {
  const { cx: scx, cy: scy } = nodeCenter(sourceNode)
  const { cx: tcx, cy: tcy } = nodeCenter(targetNode)

  const srcSize = typeSizes[sourceNode.type]
  const tgtSize = typeSizes[targetNode.type]

  const start = edgeIntersection(scx, scy, tcx, tcy, srcSize.w, srcSize.h)
  const end = edgeIntersection(tcx, tcy, scx, scy, tgtSize.w, tgtSize.h)

  const color = CONNECTOR_COLORS[edge.connector]
  const dash = CONNECTOR_DASH[edge.connector]
  const label = edge.label || CONNECTOR_LABELS[edge.connector]

  // Midpoint for label
  const mx = (start.x + end.x) / 2
  const my = (start.y + end.y) / 2

  // Arrow head
  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  const arrowLen = 10
  const arrowAngle = Math.PI / 7
  const a1x = end.x - arrowLen * Math.cos(angle - arrowAngle)
  const a1y = end.y - arrowLen * Math.sin(angle - arrowAngle)
  const a2x = end.x - arrowLen * Math.cos(angle + arrowAngle)
  const a2y = end.y - arrowLen * Math.sin(angle + arrowAngle)

  return (
    <g
      className="cursor-pointer"
      onClick={(e) => {
        e.stopPropagation()
        onClick(edge.id)
      }}
    >
      {/* Invisible fat line for easier clicking */}
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        stroke="transparent"
        strokeWidth={12}
      />
      {/* Visible line */}
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        stroke={color}
        strokeWidth={selected ? 2.5 : 1.5}
        strokeDasharray={dash}
        markerEnd=""
      />
      {/* Arrow head (hidden for non-directional connectors) */}
      {!CONNECTOR_NO_ARROW.has(edge.connector) && (
        <polygon
          points={`${end.x},${end.y} ${a1x},${a1y} ${a2x},${a2y}`}
          fill={color}
        />
      )}
      {/* Selection highlight */}
      {selected && (
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke="#3b82f6"
          strokeWidth={4}
          opacity={0.3}
          strokeDasharray=""
        />
      )}
      {/* Label */}
      <rect
        x={mx - 18}
        y={my - 8}
        width={36}
        height={16}
        rx={3}
        fill="white"
        stroke={color}
        strokeWidth={0.5}
        opacity={0.95}
      />
      <text
        x={mx}
        y={my + 4}
        textAnchor="middle"
        fontSize={9}
        fontWeight={600}
        fill={color}
      >
        {label}
      </text>
    </g>
  )
}

/* ------------------------------------------------------------------ */
/*  Palette tile (sidebar)                                             */
/* ------------------------------------------------------------------ */

function PaletteTile({ component }: { component: Component }) {
  const colors = TYPE_COLORS[component.type]

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          "application/json",
          JSON.stringify({
            componentId: component.id,
            name: component.name,
            type: component.type,
          })
        )
        e.dataTransfer.effectAllowed = "copy"
      }}
      className="flex items-center gap-1.5 px-2 py-1.5 rounded border-l-[3px] cursor-grab active:cursor-grabbing hover:shadow-sm transition-shadow select-none"
      style={{
        borderLeftColor: colors.border,
        backgroundColor: `${colors.fill}30`,
      }}
    >
      <GripVertical className="h-3 w-3 text-muted-foreground/50 shrink-0" />
      <TypeIcon
        type={component.type}
        className="h-3.5 w-3.5 shrink-0"
        style={{ color: colors.text }}
      />
      <span className="text-xs font-medium truncate">{component.name}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main builder page                                                  */
/* ------------------------------------------------------------------ */

export default function DiagramBuilderPage() {
  const [components, setComponents] = useState<Component[]>([])
  const [nodes, setNodes] = useState<CanvasNode[]>([])
  const [edges, setEdges] = useState<CanvasEdge[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [diagramName, setDiagramName] = useState("new-diagram")
  const [paletteSearch, setPaletteSearch] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [toolMode, setToolMode] = useState<ToolMode>("select")
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null)
  const [connectorType, setConnectorType] = useState<ConnectorType>("rest")

  const [repoDiagrams, setRepoDiagrams] = useState<DiagramWithSha[]>([])
  const [loadDialogOpen, setLoadDialogOpen] = useState(false)

  const canvasWrapperRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{
    nodeId: string
    offsetX: number
    offsetY: number
  } | null>(null)

  // Load components
  useEffect(() => {
    fetch("/api/components")
      .then(async (r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`)
        return r.json()
      })
      .then((data) => setComponents(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load components:", err))
  }, [])

  // Load repo diagrams list (for the open dialog)
  useEffect(() => {
    fetch("/api/diagrams")
      .then(async (r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`)
        return r.json()
      })
      .then((data) => setRepoDiagrams(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load diagrams:", err))
  }, [])

  // Load diagram from URL query param (?load=name)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const loadName = params.get("load")
    if (!loadName) return

    fetch(`/api/diagrams/${encodeURIComponent(loadName)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found")
        return r.json()
      })
      .then((diagram: DiagramWithSha) => {
        const { nodes: parsedNodes, edges: parsedEdges } = parseDrawioXml(diagram.content)
        setNodes(parsedNodes)
        setEdges(parsedEdges)
        setDiagramName(diagram.name)
        setSelectedNodeId(null)
        setSelectedEdgeId(null)
        setConnectSourceId(null)
        setToolMode("select")
      })
      .catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------- Load drawio content ---------- */

  const loadDrawioContent = useCallback((xmlContent: string, name: string) => {
    const { nodes: parsedNodes, edges: parsedEdges } = parseDrawioXml(xmlContent)
    setNodes(parsedNodes)
    setEdges(parsedEdges)
    setDiagramName(name)
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setConnectSourceId(null)
    setToolMode("select")
  }, [])

  const handleLoadFromFile = (file: File) => {
    const name = file.name.replace(/\.drawio$/i, "")
    file.text().then((content) => {
      loadDrawioContent(content, name)
    })
  }

  const handleLoadFromRepo = (diagram: DiagramWithSha) => {
    loadDrawioContent(diagram.content, diagram.name)
    setLoadDialogOpen(false)
  }

  // Filter palette by search
  const filteredComponents = components.filter(
    (c) =>
      !paletteSearch ||
      c.name.toLowerCase().includes(paletteSearch.toLowerCase()) ||
      c.id.toLowerCase().includes(paletteSearch.toLowerCase()) ||
      c.type.toLowerCase().includes(paletteSearch.toLowerCase())
  )

  // Group palette by type
  const groupedPalette = COMPONENT_TYPES
    .map((t) => ({
      type: t,
      items: filteredComponents.filter((c) => c.type === t),
    }))
    .filter((g) => g.items.length > 0)

  /* ---------- Clear selection helpers ---------- */

  const clearSelection = useCallback(() => {
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    if (toolMode === "connect") {
      setConnectSourceId(null)
    }
  }, [toolMode])

  /* ---------- Canvas drag-and-drop (from palette) ---------- */

  const handleCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const json = e.dataTransfer.getData("application/json")
      if (!json) return

      try {
        const data = JSON.parse(json) as {
          componentId: string
          name: string
          type: ComponentType
        }

        const wrapper = canvasWrapperRef.current
        if (!wrapper) return
        const rect = wrapper.getBoundingClientRect()

        const canvasX = (e.clientX - rect.left + wrapper.scrollLeft) / zoom
        const canvasY = (e.clientY - rect.top + wrapper.scrollTop) / zoom
        const x = Math.round(canvasX / 10) * 10
        const y = Math.round(canvasY / 10) * 10

        const newNode: CanvasNode = {
          id: `${data.componentId}-${Date.now()}`,
          componentId: data.componentId,
          name: data.name,
          type: data.type,
          x: Math.max(0, x - typeSizes[data.type].w / 2),
          y: Math.max(0, y - typeSizes[data.type].h / 2),
        }

        setNodes((prev) => [...prev, newNode])
        setSelectedNodeId(newNode.id)
        setSelectedEdgeId(null)
      } catch {
        // ignore invalid
      }
    },
    [zoom]
  )

  /* ---------- Canvas node move (mouse drag) ---------- */

  const handleNodeMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      if (toolMode !== "select") return
      const node = nodes.find((n) => n.id === nodeId)
      if (!node || !canvasWrapperRef.current) return

      const wrapper = canvasWrapperRef.current
      const rect = wrapper.getBoundingClientRect()

      const canvasX = (e.clientX - rect.left + wrapper.scrollLeft) / zoom
      const canvasY = (e.clientY - rect.top + wrapper.scrollTop) / zoom

      dragRef.current = {
        nodeId,
        offsetX: canvasX - node.x,
        offsetY: canvasY - node.y,
      }
    },
    [nodes, zoom, toolMode]
  )

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current || !canvasWrapperRef.current) return

      const wrapper = canvasWrapperRef.current
      const rect = wrapper.getBoundingClientRect()

      const canvasX = (e.clientX - rect.left + wrapper.scrollLeft) / zoom
      const canvasY = (e.clientY - rect.top + wrapper.scrollTop) / zoom

      const x = Math.round((canvasX - dragRef.current.offsetX) / 10) * 10
      const y = Math.round((canvasY - dragRef.current.offsetY) / 10) * 10

      setNodes((prev) =>
        prev.map((n) =>
          n.id === dragRef.current!.nodeId
            ? { ...n, x: Math.max(0, x), y: Math.max(0, y) }
            : n
        )
      )
    }

    const handleMouseUp = () => {
      dragRef.current = null
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [zoom])

  /* ---------- Node click handler (select or connect) ---------- */

  const handleNodeClick = useCallback(
    (_e: React.MouseEvent, nodeId: string) => {
      if (toolMode === "connect") {
        if (!connectSourceId) {
          // First click — set source
          setConnectSourceId(nodeId)
          setSelectedNodeId(null)
          setSelectedEdgeId(null)
        } else if (connectSourceId !== nodeId) {
          // Second click — create edge
          const newEdge: CanvasEdge = {
            id: `edge-${Date.now()}`,
            sourceId: connectSourceId,
            targetId: nodeId,
            connector: connectorType,
            label: CONNECTOR_LABELS[connectorType],
          }
          setEdges((prev) => [...prev, newEdge])
          setConnectSourceId(null)
          setSelectedEdgeId(newEdge.id)
          setSelectedNodeId(null)
        } else {
          // Clicked same node — cancel
          setConnectSourceId(null)
        }
      } else {
        setSelectedNodeId(nodeId)
        setSelectedEdgeId(null)
      }
    },
    [toolMode, connectSourceId, connectorType]
  )

  /* ---------- Edge click handler ---------- */

  const handleEdgeClick = useCallback((edgeId: string) => {
    setSelectedEdgeId(edgeId)
    setSelectedNodeId(null)
  }, [])

  /* ---------- Delete selected ---------- */

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement
        )
          return

        if (selectedEdgeId) {
          setEdges((prev) => prev.filter((edge) => edge.id !== selectedEdgeId))
          setSelectedEdgeId(null)
        } else if (selectedNodeId) {
          // Remove node and all connected edges
          setEdges((prev) =>
            prev.filter(
              (edge) =>
                edge.sourceId !== selectedNodeId &&
                edge.targetId !== selectedNodeId
            )
          )
          setNodes((prev) => prev.filter((n) => n.id !== selectedNodeId))
          setSelectedNodeId(null)
        }
      }

      // Escape to cancel connect mode source
      if (e.key === "Escape") {
        setConnectSourceId(null)
        if (toolMode === "connect") {
          setToolMode("select")
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectedNodeId, selectedEdgeId, toolMode])

  /* ---------- Export as .drawio file ---------- */

  const handleExport = () => {
    const xml = generateDrawioXml(nodes, edges, diagramName)
    const blob = new Blob([xml], { type: "application/xml" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${diagramName}.drawio`
    a.click()
    URL.revokeObjectURL(url)
  }

  /* ---------- Save to repo ---------- */

  const handleSave = async () => {
    setSaving(true)
    try {
      const xml = generateDrawioXml(nodes, edges, diagramName)

      // Check if diagram already exists to get its sha for update
      let sha: string | undefined
      try {
        const existing = await fetch(`/api/diagrams/${encodeURIComponent(diagramName)}`)
        if (existing.ok) {
          const data = await existing.json()
          sha = data.sha
        }
      } catch {
        // doesn't exist yet, that's fine
      }

      const body: Record<string, string> = { name: diagramName, content: xml }
      if (sha) body.sha = sha

      const res = await fetch("/api/diagrams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error("Failed to save")
      setSaveMessage("Saved!")
      setTimeout(() => setSaveMessage(null), 3000)
    } catch (err) {
      console.error("Save failed:", err)
      setSaveMessage("Save failed!")
      setTimeout(() => setSaveMessage(null), 3000)
    } finally {
      setSaving(false)
    }
  }

  /* ---------- Zoom ---------- */

  const zoomIn = () => setZoom((z) => Math.min(2, z + 0.1))
  const zoomOut = () => setZoom((z) => Math.max(0.3, z - 0.1))
  const zoomFit = () => setZoom(1)

  /* ---------- Delete handler for toolbar ---------- */

  const handleDeleteSelected = () => {
    if (selectedEdgeId) {
      setEdges((prev) => prev.filter((e) => e.id !== selectedEdgeId))
      setSelectedEdgeId(null)
    } else if (selectedNodeId) {
      setEdges((prev) =>
        prev.filter(
          (e) => e.sourceId !== selectedNodeId && e.targetId !== selectedNodeId
        )
      )
      setNodes((prev) => prev.filter((n) => n.id !== selectedNodeId))
      setSelectedNodeId(null)
    }
  }

  /* ---------- Update selected edge connector type ---------- */

  const handleEdgeConnectorChange = (value: string) => {
    const ct = value as ConnectorType
    if (selectedEdgeId) {
      setEdges((prev) =>
        prev.map((e) =>
          e.id === selectedEdgeId
            ? { ...e, connector: ct, label: CONNECTOR_LABELS[ct] }
            : e
        )
      )
    }
    setConnectorType(ct)
  }

  const selectedEdge = edges.find((e) => e.id === selectedEdgeId)
  const hasSelection = !!selectedNodeId || !!selectedEdgeId
  const itemCount = nodes.length + edges.length

  /* ---------- Render ---------- */

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      {/* Top bar */}
      <div className="flex items-center gap-3 pb-4 border-b mb-0 shrink-0 flex-wrap">
        <Link href="/diagrams">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <Input
            value={diagramName}
            onChange={(e) => setDiagramName(e.target.value)}
            className="w-52 font-mono text-sm"
            placeholder="Diagram name..."
          />
          <span className="text-sm text-muted-foreground">.drawio</span>
        </div>

        {/* Open / Load */}
        <div className="flex items-center gap-1 border rounded-md p-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => fileInputRef.current?.click()}
            title="Open .drawio file"
          >
            <Upload className="h-3.5 w-3.5" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".drawio"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleLoadFromFile(file)
              e.target.value = ""
            }}
          />
          <Dialog open={loadDialogOpen} onOpenChange={setLoadDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Open from repository"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Open Diagram from Repository</DialogTitle>
              </DialogHeader>
              {repoDiagrams.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No diagrams in the repository yet.
                </p>
              ) : (
                <div className="space-y-1 max-h-[50vh] overflow-y-auto">
                  {repoDiagrams.map((d) => (
                    <button
                      key={d.name}
                      onClick={() => handleLoadFromRepo(d)}
                      className="flex items-center gap-3 w-full p-3 rounded-md border hover:bg-muted/50 transition-colors text-left"
                    >
                      <FileImage className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-mono text-sm flex-1">{d.name}.drawio</span>
                      <span className="text-xs text-muted-foreground">
                        {(d.content.length / 1024).toFixed(1)} KB
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>

        {/* Tool mode selector */}
        <div className="flex items-center gap-1 border rounded-md p-1">
          <Button
            variant={toolMode === "select" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              setToolMode("select")
              setConnectSourceId(null)
            }}
            title="Select & Move (V)"
          >
            <MousePointer2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={toolMode === "connect" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              setToolMode("connect")
              setSelectedNodeId(null)
              setSelectedEdgeId(null)
            }}
            title="Connect (C)"
          >
            <Spline className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Connector type */}
        <Select
          value={selectedEdge ? selectedEdge.connector : connectorType}
          onValueChange={handleEdgeConnectorChange}
        >
          <SelectTrigger className="w-[120px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONNECTOR_TYPES.map((ct) => (
              <SelectItem key={ct} value={ct}>
                <span className="flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full inline-block"
                    style={{ backgroundColor: CONNECTOR_COLORS[ct] }}
                  />
                  {CONNECTOR_LABELS[ct]}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Connect mode hint */}
        {toolMode === "connect" && (
          <span className="text-xs text-orange-600 font-medium">
            {connectSourceId
              ? "Click target component..."
              : "Click source component..."}
          </span>
        )}

        {/* Zoom */}
        <div className="flex items-center gap-1 border rounded-md p-1 ml-auto">
          <Button variant="ghost" size="icon" onClick={zoomOut} title="Zoom out" className="h-7 w-7">
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Button variant="ghost" size="icon" onClick={zoomIn} title="Zoom in" className="h-7 w-7">
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={zoomFit} title="Reset zoom" className="h-7 w-7">
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {nodes.length} node{nodes.length !== 1 ? "s" : ""}, {edges.length} edge{edges.length !== 1 ? "s" : ""}
        </span>

        {hasSelection && (
          <Button variant="outline" size="sm" onClick={handleDeleteSelected}>
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Remove
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={handleExport} disabled={itemCount === 0}>
          <Download className="h-3.5 w-3.5 mr-1" />
          Export
        </Button>
        <Button size="sm" onClick={handleSave} disabled={itemCount === 0 || saving}>
          <Save className="h-3.5 w-3.5 mr-1" />
          {saving ? "Saving..." : "Save"}
        </Button>
        {saveMessage && (
          <span className={`text-xs font-medium ${saveMessage === "Saved!" ? "text-green-600" : "text-red-600"}`}>
            {saveMessage}
          </span>
        )}
      </div>

      {/* Main area: sidebar + canvas */}
      <div className="flex flex-1 min-h-0 mt-4 gap-4">
        {/* Palette sidebar */}
        <div className="w-56 shrink-0 flex flex-col border rounded-lg bg-muted/30">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search components..."
                value={paletteSearch}
                onChange={(e) => setPaletteSearch(e.target.value)}
                className="pl-7 h-8 text-xs"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-3">
            {groupedPalette.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                No components found
              </p>
            ) : (
              groupedPalette.map(({ type, items }) => {
                const colors = TYPE_COLORS[type]
                return (
                  <div key={type}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <TypeIcon
                        type={type}
                        className="h-3 w-3"
                        style={{ color: colors.text }}
                      />
                      <span
                        className="text-[10px] uppercase tracking-wide font-semibold"
                        style={{ color: colors.text }}
                      >
                        {TYPE_LABELS[type]}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        ({items.length})
                      </span>
                    </div>
                    <div className="space-y-1">
                      {items.map((c) => (
                        <PaletteTile key={c.id} component={c} />
                      ))}
                    </div>
                  </div>
                )
              })
            )}
          </div>
          <div className="p-2 border-t text-[10px] text-muted-foreground text-center">
            Drag components onto the canvas
          </div>
        </div>

        {/* Canvas */}
        <div
          ref={canvasWrapperRef}
          className="flex-1 border rounded-lg bg-white overflow-auto relative"
          style={{
            backgroundImage:
              "radial-gradient(circle, #e5e7eb 1px, transparent 1px)",
            backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = "copy"
          }}
          onDrop={handleCanvasDrop}
          onClick={clearSelection}
        >
          <div
            className="relative min-w-[1600px] min-h-[900px] origin-top-left"
            style={{ transform: `scale(${zoom})` }}
          >
            {/* SVG layer for edges */}
            <svg
              className="absolute inset-0 pointer-events-none"
              width="1600"
              height="900"
              style={{ zIndex: 5, pointerEvents: "none" }}
            >
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="7"
                  refX="10"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill="#666" />
                </marker>
              </defs>
              <g style={{ pointerEvents: "auto" }}>
                {edges.map((edge) => {
                  const srcNode = nodes.find((n) => n.id === edge.sourceId)
                  const tgtNode = nodes.find((n) => n.id === edge.targetId)
                  if (!srcNode || !tgtNode) return null
                  return (
                    <EdgeArrow
                      key={edge.id}
                      edge={edge}
                      sourceNode={srcNode}
                      targetNode={tgtNode}
                      selected={edge.id === selectedEdgeId}
                      onClick={handleEdgeClick}
                    />
                  )
                })}
              </g>
            </svg>

            {/* Nodes */}
            {nodes.map((node) => (
              <CanvasTile
                key={node.id}
                node={node}
                selected={node.id === selectedNodeId}
                connectSource={node.id === connectSourceId}
                toolMode={toolMode}
                onMouseDown={handleNodeMouseDown}
                onClick={handleNodeClick}
              />
            ))}

            {nodes.length === 0 && edges.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center text-muted-foreground">
                  <p className="text-lg font-medium">Drop components here</p>
                  <p className="text-sm mt-1">
                    Drag components from the palette, then use the connect tool to draw arrows
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
