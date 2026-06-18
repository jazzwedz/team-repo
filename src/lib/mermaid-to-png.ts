"use client"

// Render the mermaid diagrams in a DSD markdown to PNG, in the browser, so
// they can be attached to a Confluence page (which has no mermaid plugin).
//
// Why client-side: mermaid needs a DOM to render, and the corp environment
// has no outbound access for a server-side headless browser. The viewer
// already renders these exact diagrams — we reuse mermaid here and rasterise
// the SVG to PNG via a canvas. htmlLabels is disabled so the SVG has no
// <foreignObject> (which canvas can't rasterise) — labels render as SVG text.

import mermaid from "mermaid"

let inited = false
function ensureInit() {
  if (inited) return
  mermaid.initialize({
    startOnLoad: false,
    theme: "default",
    securityLevel: "strict",
    flowchart: { htmlLabels: false, useMaxWidth: true },
  })
  inited = true
}

/** The mermaid source of each ```mermaid block, in document order. */
export function extractMermaidBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```mermaid\s*\n([\s\S]*?)```/gi)].map((m) => m[1].trim())
}

async function svgToPngBase64(svg: string): Promise<string> {
  // Intrinsic size from the viewBox; fall back to a sane default.
  let w = 900
  let h = 600
  const m = svg.match(/viewBox="([\d.\-eE\s]+)"/)
  if (m) {
    const p = m[1].trim().split(/\s+/).map(Number)
    if (p.length === 4 && p[2] > 0 && p[3] > 0) {
      w = p[2]
      h = p[3]
    }
  }
  // Ensure a self-contained SVG with explicit size + XML namespace, then
  // load it via a Blob URL (more reliable than a data URL for <img>: no
  // length/encoding pitfalls, the browser parses the SVG file directly).
  let sized = svg.replace(/<svg\b/, `<svg width="${Math.ceil(w)}" height="${Math.ceil(h)}"`)
  if (!/xmlns=/.test(sized)) {
    sized = sized.replace(/<svg\b/, `<svg xmlns="http://www.w3.org/2000/svg"`)
  }
  const blobUrl = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }))
  try {
    const img = new Image()
    img.width = Math.ceil(w)
    img.height = Math.ceil(h)
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error("SVG image load failed"))
      img.src = blobUrl
    })

    const scale = 2 // crisper output for Confluence
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.ceil(w * scale))
    canvas.height = Math.max(1, Math.ceil(h * scale))
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("no 2d canvas context")
    ctx.fillStyle = "#ffffff" // Confluence pages are light; avoid transparent bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.drawImage(img, 0, 0, w, h)
    const dataUrl = canvas.toDataURL("image/png")
    return dataUrl.split(",")[1] || ""
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

export interface DiagramPng {
  /** diagram-N.png — N is the 1-based document order of the mermaid block. */
  filename: string
  /** base64 PNG bytes (no data: prefix). */
  base64: string
}

/**
 * Render every mermaid block in the markdown to a PNG. Failures are skipped
 * (the server then strips that block) so one bad diagram never blocks the
 * publish. Numbering matches the server's block enumeration → filenames line
 * up with the <ac:image> placeholders.
 */
export async function renderDsdDiagramPngs(markdown: string): Promise<DiagramPng[]> {
  ensureInit()
  const blocks = extractMermaidBlocks(markdown)
  const out: DiagramPng[] = []
  for (let i = 0; i < blocks.length; i++) {
    try {
      const id = `dsdpub-${i}-${Math.random().toString(36).slice(2, 8)}`
      const { svg } = await mermaid.render(id, blocks[i])
      const base64 = await svgToPngBase64(svg)
      if (base64) out.push({ filename: `diagram-${i + 1}.png`, base64 })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`DSD diagram ${i + 1} render failed; it will be omitted`, e)
    }
  }
  return out
}
