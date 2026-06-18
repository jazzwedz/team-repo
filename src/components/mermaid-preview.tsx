"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import mermaid from "mermaid"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ZoomIn, ZoomOut, Maximize2, RotateCcw, Expand } from "lucide-react"

mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "strict",
  flowchart: {
    useMaxWidth: true,
    htmlLabels: true,
    curve: "basis",
  },
})

export function MermaidPreview({
  chart,
  className,
  zoomable = false,
  expandable = false,
  expandTitle = "Diagram",
  height = 360,
}: {
  chart: string
  className?: string
  /** Render at natural size with pan/zoom controls instead of fit-to-width
   *  scaling, so labels stay readable as the diagram grows. */
  zoomable?: boolean
  /** Show an "Expand" button that opens the diagram in a large modal. */
  expandable?: boolean
  expandTitle?: string
  /** Viewport height (px) for the zoomable container. */
  height?: number
}) {
  const [svg, setSvg] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError(null)
    setSvg("")
    const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`
    mermaid
      .render(id, chart)
      .then(({ svg }) => {
        if (!cancelled) setSvg(svg)
      })
      .catch((err) => {
        console.error("Mermaid render failed:", err)
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [chart])

  // Render failure: surface it (and keep the source) instead of getting
  // stuck on "Rendering diagram..." forever, which hides real problems.
  if (error) {
    return (
      <div className={`rounded-md border border-amber-300 bg-amber-50 p-3 text-xs ${className || ""}`}>
        <div className="font-medium text-amber-900 mb-1">Diagram could not be rendered.</div>
        <pre className="whitespace-pre-wrap text-amber-900/80 overflow-x-auto">{chart}</pre>
      </div>
    )
  }

  if (!svg) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm p-4">
        Rendering diagram...
      </div>
    )
  }

  // Legacy fit-to-width behaviour (unchanged) for every non-zoomable caller.
  if (!zoomable) {
    return (
      <div
        className={`flex items-center justify-center overflow-auto ${className || ""}`}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    )
  }

  return (
    <div className={className}>
      <div className="relative">
        <ZoomPanSvg svg={svg} height={height} />
        {expandable && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="absolute right-2 top-2 h-7 bg-background/90"
            onClick={() => setExpanded(true)}
            title="Open large view"
          >
            <Expand className="h-3.5 w-3.5 mr-1" />
            Expand
          </Button>
        )}
      </div>

      {expandable && (
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className="max-w-[95vw] w-[95vw]">
            <DialogHeader>
              <DialogTitle>{expandTitle}</DialogTitle>
            </DialogHeader>
            <ZoomPanSvg svg={svg} height={Math.round(typeof window !== "undefined" ? window.innerHeight * 0.7 : 600)} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// Renders a mermaid SVG at its natural size inside a fixed-height viewport
// with pan (drag) and zoom (buttons / wheel). The SVG keeps its intrinsic
// pixel size — text never shrinks to fit — and the transform scales it, so
// labels stay crisp at any zoom. "Fit" sizes the whole diagram into the
// viewport; from there the analyst zooms in to read.
function ZoomPanSvg({ svg, height }: { svg: string; height: number }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  // Parse intrinsic size from the SVG viewBox.
  const dims = useCallback(() => {
    const m = svg.match(/viewBox="([\d.\-eE\s]+)"/)
    if (m) {
      const p = m[1].trim().split(/\s+/).map(Number)
      if (p.length === 4 && p[2] > 0 && p[3] > 0) return { w: p[2], h: p[3] }
    }
    return null
  }, [svg])

  const fit = useCallback(() => {
    const d = dims()
    const vp = viewportRef.current
    if (!d || !vp) {
      setZoom(1)
      setPan({ x: 0, y: 0 })
      return
    }
    const z = Math.min(vp.clientWidth / d.w, vp.clientHeight / d.h, 1)
    setZoom(z > 0 ? z : 1)
    // Centre horizontally.
    setPan({ x: Math.max(0, (vp.clientWidth - d.w * z) / 2), y: 0 })
  }, [dims])

  // Recompute natural size + fit whenever the diagram changes, and strip
  // mermaid's fit-to-width sizing from the rendered <svg> so it draws at its
  // intrinsic pixel size (the wrapper transform handles scaling instead).
  useEffect(() => {
    const d = dims()
    setNatural(d)
    const el = contentRef.current?.querySelector("svg")
    if (el && d) {
      el.setAttribute("width", String(d.w))
      el.setAttribute("height", String(d.h))
      el.style.maxWidth = "none"
    }
    // Defer so the viewport has its measured width.
    const t = setTimeout(fit, 0)
    return () => clearTimeout(t)
  }, [svg, dims, fit])

  const clampZoom = (z: number) => Math.min(4, Math.max(0.1, z))
  const zoomBy = (factor: number) => setZoom((z) => clampZoom(z * factor))

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    setPan({
      x: drag.current.px + (e.clientX - drag.current.x),
      y: drag.current.py + (e.clientY - drag.current.y),
    })
  }
  const onPointerUp = () => {
    drag.current = null
  }
  const onWheel = (e: React.WheelEvent) => {
    // Zoom on wheel only when the pointer is over the viewport.
    e.preventDefault()
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1)
  }

  return (
    <div className="rounded-md border bg-background">
      <div className="flex items-center justify-end gap-1 border-b px-1.5 py-1">
        <span className="mr-auto pl-1 text-[11px] text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <Button type="button" size="icon" variant="ghost" className="h-6 w-6" title="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="h-6 w-6" title="Zoom in" onClick={() => zoomBy(1.2)}>
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="h-6 w-6" title="Fit" onClick={fit}>
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="h-6 w-6" title="Reset (100%)" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div
        ref={viewportRef}
        className="relative overflow-hidden touch-none cursor-grab active:cursor-grabbing"
        style={{ height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
      >
        <div
          ref={contentRef}
          className="absolute left-0 top-0 origin-top-left"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            width: natural ? natural.w : undefined,
            height: natural ? natural.h : undefined,
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  )
}
