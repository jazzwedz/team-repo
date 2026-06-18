export function drawioToMermaid(xml: string, highlightArchId?: string): string | null {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, "text/xml")

    const nodes = new Map<string, string>()
    const nodeArchIds = new Map<string, string>() // drawio id -> arch_id
    const edges: { source: string; target: string; label: string }[] = []

    const stripHtml = (s: string) => {
      // Loop tag-strip until idempotent so nested fragments like "<<b>foo>"
      // don't survive a single pass (codeql: js/incomplete-multi-character-sanitization).
      let prev: string
      let cur = s.replace(/<br\s*\/?>/gi, " ")
      do {
        prev = cur
        cur = cur.replace(/<[^>]+>/g, "")
      } while (cur !== prev)
      // Decode `&amp;` LAST so `&amp;lt;` stays as `&lt;` instead of collapsing
      // to `<` (codeql: js/double-escaping).
      return cur
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .trim()
    }

    // Process UserObject/object wrappers (draw.io uses these for custom properties)
    doc.querySelectorAll("UserObject, object").forEach((obj) => {
      const id = obj.getAttribute("id")
      const label = obj.getAttribute("label")
      const childCell = obj.querySelector("mxCell")
      if (!id || !childCell) return

      if (childCell.getAttribute("vertex") === "1" && label) {
        nodes.set(id, stripHtml(label))
        const archId = obj.getAttribute("arch_id")
        if (archId) nodeArchIds.set(id, archId)
      }
      if (childCell.getAttribute("edge") === "1") {
        const source = childCell.getAttribute("source")
        const target = childCell.getAttribute("target")
        if (source && target) {
          edges.push({ source, target, label: stripHtml(label || "") })
        }
      }
    })

    // Process standalone mxCell elements (not inside UserObject)
    doc.querySelectorAll("mxCell").forEach((cell) => {
      if (
        cell.parentElement?.tagName === "UserObject" ||
        cell.parentElement?.tagName === "object"
      )
        return

      const id = cell.getAttribute("id")
      const value = cell.getAttribute("value")
      const parent = cell.getAttribute("parent")

      if (
        cell.getAttribute("vertex") === "1" &&
        id &&
        parent !== "0" &&
        value
      ) {
        const label = stripHtml(value)
        if (label) nodes.set(id, label)
      }

      if (cell.getAttribute("edge") === "1") {
        const source = cell.getAttribute("source")
        const target = cell.getAttribute("target")
        if (source && target) {
          edges.push({ source, target, label: stripHtml(value || "") })
        }
      }
    })

    if (nodes.size === 0) return null

    // Build mermaid flowchart
    const lines: string[] = ["graph TD"]

    const sanitize = (s: string) =>
      s
        .replace(/"/g, "'")
        .replace(/[\[\](){}]/g, " ")
        .replace(/\s+/g, " ")
        .trim()

    nodes.forEach((label, id) => {
      lines.push(`  ${id}["${sanitize(label)}"]`)
    })

    edges.forEach((e) => {
      if (nodes.has(e.source) && nodes.has(e.target)) {
        if (e.label) {
          lines.push(`  ${e.source} -->|${sanitize(e.label)}| ${e.target}`)
        } else {
          lines.push(`  ${e.source} --> ${e.target}`)
        }
      }
    })

    if (edges.length === 0 && nodes.size < 2) return null

    // Highlight the selected component
    if (highlightArchId) {
      const highlightNodeIds: string[] = []
      nodeArchIds.forEach((archId, nodeId) => {
        if (archId === highlightArchId) highlightNodeIds.push(nodeId)
      })
      // Also check if any node label matches the arch_id directly (standalone mxCells)
      nodes.forEach((label, nodeId) => {
        if (label === highlightArchId && !highlightNodeIds.includes(nodeId)) {
          highlightNodeIds.push(nodeId)
        }
      })
      for (const nodeId of highlightNodeIds) {
        lines.push(`  style ${nodeId} fill:#2563eb,stroke:#1d4ed8,color:#fff,stroke-width:2px`)
      }
    }

    return lines.join("\n")
  } catch {
    return null
  }
}
