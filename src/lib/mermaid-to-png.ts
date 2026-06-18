"use client"

// Render the mermaid diagrams in a DSD markdown to images, in the browser,
// so they can be attached to a Confluence page (which has no mermaid plugin).
//
// We attach the SVG itself (not a rasterised PNG): drawing a mermaid SVG to
// a <canvas> taints it (the browser then blocks canvas.toDataURL with a
// SecurityError — "Tainted canvases may not be exported"), because mermaid
// SVGs carry foreignObject / styling the canvas treats as cross-origin.
// Uploading the SVG sidesteps the canvas entirely and is vector-sharp;
// Confluence Data Center renders an SVG attachment in <ac:image>.

import mermaid from "mermaid"

let inited = false
function ensureInit() {
  if (inited) return
  mermaid.initialize({
    startOnLoad: false,
    theme: "default",
    securityLevel: "strict",
    htmlLabels: false,
    flowchart: { htmlLabels: false, useMaxWidth: true },
  })
  inited = true
}

/** The mermaid source of each ```mermaid block, in document order. */
export function extractMermaidBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```mermaid\s*\n([\s\S]*?)```/gi)].map((m) => m[1].trim())
}

// Normalise the root <svg> tag: give it explicit width/height (from the
// viewBox) and ensure the XML namespaces, without duplicating attributes
// mermaid already emits (width="100%"/style), which would make invalid XML.
function normaliseSvg(svg: string): string {
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
  return svg.replace(/<svg\b([^>]*)>/i, (_full, attrs: string) => {
    const cleaned = attrs
      .replace(/\swidth="[^"]*"/gi, "")
      .replace(/\sheight="[^"]*"/gi, "")
      .replace(/\sstyle="[^"]*"/gi, "")
    const ns: string[] = []
    if (!/xmlns=/.test(cleaned)) ns.push(' xmlns="http://www.w3.org/2000/svg"')
    if (!/xmlns:xlink=/.test(cleaned)) ns.push(' xmlns:xlink="http://www.w3.org/1999/xlink"')
    return `<svg width="${Math.ceil(w)}" height="${Math.ceil(h)}"${ns.join("")}${cleaned}>`
  })
}

/** UTF-8-safe base64 of a string (SVG labels can be non-ASCII). */
function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ""
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

export interface DiagramImage {
  /** diagram-N.svg — N is the 1-based document order of the mermaid block. */
  filename: string
  /** base64-encoded SVG bytes. */
  base64: string
}

/**
 * Render every mermaid block in the markdown to an SVG image. Failures are
 * skipped (the server then strips that block) so one bad diagram never
 * blocks the publish. Numbering matches the server's block enumeration → the
 * filenames line up with the <ac:image> placeholders.
 */
export async function renderDsdDiagramImages(markdown: string): Promise<DiagramImage[]> {
  ensureInit()
  const blocks = extractMermaidBlocks(markdown)
  const out: DiagramImage[] = []
  for (let i = 0; i < blocks.length; i++) {
    try {
      const id = `dsdpub-${i}-${Math.random().toString(36).slice(2, 8)}`
      const { svg } = await mermaid.render(id, blocks[i])
      const normalised = normaliseSvg(svg)
      out.push({ filename: `diagram-${i + 1}.svg`, base64: toBase64(normalised) })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`DSD diagram ${i + 1} render failed; it will be omitted`, e)
    }
  }
  return out
}
