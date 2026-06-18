// Convert AI-generated markdown documentation + component metadata
// into Confluence Cloud storage format.

import { marked } from "marked"
import type { Component } from "./types"
import { escapeXml } from "./confluence"
import {
  TYPE_LABELS,
  LINK_ROLE_LABELS,
  CAPABILITY_ROLE_LABELS,
  PROCESS_ROLE_LABELS,
  RULE_KIND_LABELS,
  DATA_CLASSIFICATION_LABELS,
} from "./constants"

const ARCH_TOOL_PUBLIC_URL =
  process.env.ARCH_TOOL_PUBLIC_URL || "https://arch-tool-jaso.up.railway.app"

// Convert markdown produced by /api/generate into Confluence storage XHTML.
// Confluence Cloud (without a mermaid plugin) renders ```mermaid blocks as
// raw text — ugly and useless to readers. We strip them before conversion
// and replace the AI's manual table-of-contents with the native Confluence
// TOC macro, which auto-builds a clickable navigator from headings.
export async function markdownToStorage(
  markdown: string,
  opts: {
    // When given, mermaid blocks are replaced (in document order) by an
    // <ac:image> referencing diagram-N.png IF that filename is in the set
    // (a pre-rendered PNG attached to the page); otherwise the block is
    // stripped as before. Without this option every mermaid block is
    // stripped (Confluence can't render the source).
    mermaidImageFiles?: Set<string>
  } = {}
): Promise<string> {
  const cleaned = replaceMermaidBlocks(markdown, opts.mermaidImageFiles)
  const html = await marked.parse(cleaned, { async: true, gfm: true, breaks: false })
  // Confluence storage format is strict XHTML — self-close void tags BEFORE
  // code blocks become CDATA (where literal <br> in a code sample must be
  // left untouched). At this point code content is still HTML-escaped.
  let storage = selfCloseVoidTags(html as string)
  storage = processCodeBlocks(storage)
  storage = replaceTableOfContents(storage)
  storage = polishParagraphs(storage)
  // Swap the diagram tokens for Confluence image macros referencing the
  // attached PNGs (added after marked so the XHTML isn't escaped).
  storage = storage.replace(
    /<p>\s*@@MERMAID_IMG_(\d+)@@\s*<\/p>|@@MERMAID_IMG_(\d+)@@/g,
    (_m, a, b) =>
      `<ac:image><ri:attachment ri:filename="diagram-${a || b}.svg"/></ac:image>`
  )
  return storage
}

// Confluence's XHTML parser rejects HTML-style void tags ("Unexpected close
// tag </p>; expected </br>"). marked emits <br>, <hr> and <img ...> in HTML
// form; rewrite them to self-closing XHTML. Idempotent.
function selfCloseVoidTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "<br/>")
    .replace(/<hr\s*\/?>/gi, "<hr/>")
    .replace(/<img\b([^>]*?)\s*\/?>/gi, (_m, attrs) => `<img${attrs}/>`)
}

// Handle ```mermaid ... ``` fenced blocks. Without `imageFiles` every block
// is removed (Confluence can't render the source). With `imageFiles`, the
// Nth block (1-based, document order — the SAME order the client renders
// PNGs in) becomes a `@@MERMAID_IMG_N@@` token when diagram-N.png is
// available, else it is stripped. Tokens are turned into <ac:image> macros
// after markdown→HTML so the XHTML survives.
function replaceMermaidBlocks(markdown: string, imageFiles?: Set<string>): string {
  let n = 0
  let out = markdown.replace(/```mermaid[\s\S]*?```\s*/gi, () => {
    n += 1
    if (imageFiles && imageFiles.has(`diagram-${n}.svg`)) {
      return `\n\n@@MERMAID_IMG_${n}@@\n\n`
    }
    return ""
  })
  // Strip prompt-leak phrases that sometimes appear when AI parrots the
  // instruction template. Keep this surgical to avoid eating real prose.
  out = out.replace(/^\s*Example format:\s*$/gim, "")
  out = out.replace(
    /(?:Include|Add)\s+a\s+mermaid\s+(?:flowchart|diagram|er\s*diagram)[^.\n]*\.?\s*/gi,
    ""
  )
  // Collapse 3+ consecutive blank lines created by the strip.
  out = out.replace(/\n{3,}/g, "\n\n")
  return out
}

// Replace <pre><code class="language-X">...</code></pre> with a Confluence
// code macro so syntax highlighting works in Confluence's native renderer.
function processCodeBlocks(html: string): string {
  return html.replace(
    /<pre><code class="language-([\w+-]+)">([\s\S]*?)<\/code><\/pre>/g,
    (_, lang, code) => {
      const decoded = decodeHtmlEntities(code)
      return (
        `<ac:structured-macro ac:name="code">` +
        `<ac:parameter ac:name="language">${escapeXml(lang)}</ac:parameter>` +
        `<ac:plain-text-body><![CDATA[${cdataSafe(decoded)}]]></ac:plain-text-body>` +
        `</ac:structured-macro>`
      )
    }
  )
}

// Replace the AI's hand-written "## Table of Contents" + numbered list
// with Confluence's native TOC macro. Cleaner visual, clickable, and
// auto-stays in sync with H2/H3 headings.
function replaceTableOfContents(html: string): string {
  // Match: <h2>Table of Contents</h2> followed by an <ol>/<ul>/<p> block of
  // chapters. Replace the list with the TOC macro; keep the heading.
  return html.replace(
    /<h2[^>]*>\s*Table of Contents\s*<\/h2>\s*(?:<ol[^>]*>[\s\S]*?<\/ol>|<ul[^>]*>[\s\S]*?<\/ul>|<p[^>]*>[\s\S]*?<\/p>)/i,
    `<h2>Table of Contents</h2>` +
      `<ac:structured-macro ac:name="toc">` +
      `<ac:parameter ac:name="minLevel">2</ac:parameter>` +
      `<ac:parameter ac:name="maxLevel">3</ac:parameter>` +
      `<ac:parameter ac:name="outline">false</ac:parameter>` +
      `<ac:parameter ac:name="style">none</ac:parameter>` +
      `</ac:structured-macro>`
  )
}

// Insert a soft <hr/> visual break before every numbered top-level chapter
// (e.g. "## 1. Version History") so chapters feel like separate sections
// rather than a single wall of text.
function polishParagraphs(html: string): string {
  return html.replace(
    /(<h2[^>]*>\s*\d+\.\s+[^<]+<\/h2>)/g,
    (_, heading: string) => `<hr/>${heading}`
  )
}

function decodeHtmlEntities(s: string): string {
  // Decode `&amp;` LAST so `&amp;lt;` stays as `&lt;` instead of collapsing
  // to `<` (codeql: js/double-escaping).
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
}

function cdataSafe(s: string): string {
  // ]]> sequences need to be split.
  return s.replace(/]]>/g, "]]]]><![CDATA[>")
}

function buildHeaderInfo(component: Component, audienceLabel: string): string {
  const archToolUrl = `${ARCH_TOOL_PUBLIC_URL}/component/${encodeURIComponent(component.id)}`
  return (
    `<ac:structured-macro ac:name="info">` +
    `<ac:rich-text-body>` +
    `<p><strong>Repository information:</strong> <a href="${escapeXml(archToolUrl)}">${escapeXml(component.name)} in arch-tool</a> · ` +
    `<strong>Audience:</strong> ${escapeXml(audienceLabel)} · ` +
    `<strong>Last sync:</strong> ${escapeXml(new Date().toISOString().slice(0, 10))}</p>` +
    `<p><em>Edit anywhere on this page. When you click <strong>Pull from Confluence</strong> in arch-tool, an AI scan compares the page to the catalog and proposes precise field-level patches you can approve. The narrative is regenerated on each publish.</em></p>` +
    `</ac:rich-text-body>` +
    `</ac:structured-macro>`
  )
}

// =====================================================================
// Structured "Component Reference" — auto-rendered tables and panels for
// every structured field on the component. This is the deterministic
// counterpart to the AI narrative: the canonical lookup section.
// =====================================================================

function htmlText(s: string): string {
  // Escape, then convert newlines: blank line → paragraph break, single
  // newline → <br/>. Used for free-text fields that may have multi-line
  // descriptions (rule.description, formula details, etc.).
  const safe = escapeXml(s)
  const paragraphs = safe.split(/\n\s*\n/)
  return paragraphs
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("")
}

function buildAtAGlanceTable(component: Component): string {
  const rows: [string, string][] = [
    ["ID", component.id],
    ["Type", TYPE_LABELS[component.type] || component.type],
    ["Status", component.status],
    ["Owner", component.owner || "—"],
    ["Tags", (component.tags || []).join(", ") || "—"],
  ]
  return (
    `<h2>At a glance</h2>` +
    `<table data-arch-tool="at-a-glance">` +
    `<tbody>` +
    rows
      .map(
        ([k, v]) =>
          `<tr><th style="width:200px;">${escapeXml(k)}</th><td>${escapeXml(v)}</td></tr>`
      )
      .join("") +
    `</tbody></table>`
  )
}

function buildCapabilitiesTable(component: Component): string {
  const caps = component.capabilities || []
  if (caps.length === 0) return ""
  const rows = caps
    .map(
      (c) =>
        `<tr>` +
        `<td><strong>${escapeXml(c.name)}</strong></td>` +
        `<td>${escapeXml(CAPABILITY_ROLE_LABELS[c.role] || c.role)}</td>` +
        `<td>${escapeXml(c.description || "—")}</td>` +
        `</tr>`
    )
    .join("")
  return (
    `<h2>Capabilities</h2>` +
    `<p>Business capabilities this component supports and the role it plays in each.</p>` +
    `<table>` +
    `<colgroup><col style="width:35%"/><col style="width:15%"/><col style="width:50%"/></colgroup>` +
    `<thead><tr><th>Capability</th><th>Role</th><th>Description</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`
  )
}

// v2: single Links table replaces buildInterfacesTable +
// buildRelationshipsTable + buildIOTables. One row per edge with
// role + protocol + target + optional name + description.
function buildLinksTable(component: Component): string {
  const list = component.links || []
  if (list.length === 0) return ""
  const rows = list
    .map(
      (l) =>
        `<tr>` +
        `<td><strong>${escapeXml(LINK_ROLE_LABELS[l.role] || l.role)}</strong></td>` +
        `<td>${escapeXml(l.protocol || "—")}</td>` +
        `<td>${l.target ? `<code>${escapeXml(l.target)}</code>` : "—"}</td>` +
        `<td>${escapeXml(l.name || "—")}</td>` +
        `<td>${escapeXml(l.description || "—")}</td>` +
        `</tr>`
    )
    .join("")
  return (
    `<h2>Links</h2>` +
    `<p>Every edge from this component to its peers — calls, serves, part-of, contains, reads-from, writes-to.</p>` +
    `<table>` +
    `<colgroup><col style="width:15%"/><col style="width:10%"/><col style="width:22%"/><col style="width:20%"/><col style="width:33%"/></colgroup>` +
    `<thead><tr><th>Role</th><th>Protocol</th><th>Target</th><th>Name</th><th>Description</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`
  )
}

function buildProcessesTable(component: Component): string {
  const list = component.processes || []
  if (list.length === 0) return ""
  const rows = list
    .map(
      (p) =>
        `<tr>` +
        `<td><strong>${escapeXml(p.name)}</strong></td>` +
        `<td>${escapeXml(PROCESS_ROLE_LABELS[p.role] || p.role)}</td>` +
        `<td>${escapeXml(p.activity || "—")}</td>` +
        `<td>${escapeXml(p.description || "—")}</td>` +
        `</tr>`
    )
    .join("")
  return (
    `<h2>Processes</h2>` +
    `<p>Business processes this component participates in.</p>` +
    `<table>` +
    `<colgroup><col style="width:30%"/><col style="width:15%"/><col style="width:25%"/><col style="width:30%"/></colgroup>` +
    `<thead><tr><th>Process</th><th>Role</th><th>Activity</th><th>Description</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`
  )
}

function panelMacro(args: {
  macro: "info" | "tip" | "warning"
  body: string
}): string {
  return (
    `<ac:structured-macro ac:name="${args.macro}">` +
    `<ac:rich-text-body>${args.body}</ac:rich-text-body>` +
    `</ac:structured-macro>`
  )
}

function buildRulesSection(component: Component): string {
  const rules = component.rules || []
  if (rules.length === 0) return ""

  const formulas = rules.filter((r) => r.kind === "formula")
  const behavioural = rules.filter((r) => r.kind === "rule")
  const constraints = rules.filter((r) => r.kind === "constraint")

  const renderFormula = (r: NonNullable<Component["rules"]>[number]): string => {
    const head = `<p><strong>${escapeXml(r.name)}</strong> · <em>${escapeXml(RULE_KIND_LABELS[r.kind] || r.kind)}</em></p>`
    const summary = r.summary
      ? `<p>${escapeXml(r.summary)}</p>`
      : ""
    const formula = r.formula
      ? `<ac:structured-macro ac:name="code">` +
        `<ac:parameter ac:name="language">text</ac:parameter>` +
        `<ac:plain-text-body><![CDATA[${cdataSafe(r.formula)}]]></ac:plain-text-body>` +
        `</ac:structured-macro>`
      : ""
    const desc = r.description ? htmlText(r.description) : ""
    return panelMacro({ macro: "info", body: head + summary + formula + desc })
  }

  const renderBehavioural = (
    r: NonNullable<Component["rules"]>[number]
  ): string => {
    const head = `<p><strong>${escapeXml(r.name)}</strong> · <em>${escapeXml(RULE_KIND_LABELS[r.kind] || r.kind)}</em></p>`
    const summary = r.summary ? `<p>${escapeXml(r.summary)}</p>` : ""
    const rows: string[] = []
    if (r.given)
      rows.push(
        `<tr><th style="width:80px;background:#ecfdf5;color:#065f46;">Given</th><td>${escapeXml(r.given)}</td></tr>`
      )
    if (r.when)
      rows.push(
        `<tr><th style="width:80px;background:#ecfdf5;color:#065f46;">When</th><td>${escapeXml(r.when)}</td></tr>`
      )
    if (r.then)
      rows.push(
        `<tr><th style="width:80px;background:#ecfdf5;color:#065f46;">Then</th><td>${escapeXml(r.then)}</td></tr>`
      )
    const table =
      rows.length > 0 ? `<table><tbody>${rows.join("")}</tbody></table>` : ""
    const desc = r.description ? htmlText(r.description) : ""
    return panelMacro({ macro: "tip", body: head + summary + table + desc })
  }

  const renderConstraint = (
    r: NonNullable<Component["rules"]>[number]
  ): string => {
    const head = `<p><strong>${escapeXml(r.name)}</strong> · <em>${escapeXml(RULE_KIND_LABELS[r.kind] || r.kind)}</em></p>`
    const summary = r.summary ? `<p>${escapeXml(r.summary)}</p>` : ""
    const enforced =
      r.enforced_in && r.enforced_in.length > 0
        ? `<p><strong>Enforced in:</strong> ${r.enforced_in.map((c) => `<code>${escapeXml(c)}</code>`).join(", ")}</p>`
        : ""
    const desc = r.description ? htmlText(r.description) : ""
    return panelMacro({
      macro: "warning",
      body: head + summary + enforced + desc,
    })
  }

  let body = `<h2>Business Rules &amp; Calculations</h2>`
  body += `<p>Calculations, behavioural rules, and invariants captured for this component.</p>`

  if (formulas.length > 0) {
    body += `<h3>Formulas</h3>`
    body += formulas.map(renderFormula).join("")
  }
  if (behavioural.length > 0) {
    body += `<h3>Behavioural rules</h3>`
    body += behavioural.map(renderBehavioural).join("")
  }
  if (constraints.length > 0) {
    body += `<h3>Constraints</h3>`
    body += constraints.map(renderConstraint).join("")
  }

  return body
}

function buildNFRTable(component: Component): string {
  const nfr = component.nfr
  if (!nfr) return ""
  const rows: [string, string][] = []
  if (nfr.availability) rows.push(["Availability target", nfr.availability])
  if (nfr.rto) rows.push(["RTO (recovery time objective)", nfr.rto])
  if (nfr.rpo) rows.push(["RPO (recovery point objective)", nfr.rpo])
  if (nfr.max_latency) rows.push(["Max latency", nfr.max_latency])
  if (nfr.throughput) rows.push(["Throughput", nfr.throughput])
  if (nfr.data_classification)
    rows.push([
      "Data classification",
      DATA_CLASSIFICATION_LABELS[nfr.data_classification] || nfr.data_classification,
    ])
  if (nfr.scaling)
    rows.push([
      "Scaling model",
      nfr.scaling.charAt(0).toUpperCase() + nfr.scaling.slice(1),
    ])
  if (rows.length === 0) return ""
  return (
    `<h2>Non-Functional Requirements</h2>` +
    `<p>Service-level commitments and operational characteristics.</p>` +
    `<table>` +
    `<colgroup><col style="width:35%"/><col style="width:65%"/></colgroup>` +
    `<tbody>` +
    rows
      .map(
        ([k, v]) =>
          `<tr><th>${escapeXml(k)}</th><td>${escapeXml(v)}</td></tr>`
      )
      .join("") +
    `</tbody></table>`
  )
}

function buildRisksList(component: Component): string {
  const list = component.risks || []
  if (list.length === 0) return ""
  return (
    `<h2>Risks</h2>` +
    `<ul>${list.map((r) => `<li>${escapeXml(r)}</li>`).join("")}</ul>`
  )
}

function buildReferenceSection(component: Component): string {
  return [
    `<hr/>`,
    `<h1 style="border-top:2px solid #cbd5e1; padding-top:8px;">Component Reference</h1>`,
    `<p><em>The structured catalog data for this component, rendered as the canonical reference. Keep edits to these sections in arch-tool — the page is regenerated on every publish.</em></p>`,
    buildAtAGlanceTable(component),
    buildCapabilitiesTable(component),
    buildLinksTable(component),
    buildProcessesTable(component),
    buildRulesSection(component),
    buildNFRTable(component),
    buildRisksList(component),
  ]
    .filter(Boolean)
    .join("\n")
}

function buildFooter(componentId: string): string {
  // Hidden marker as a defensive fallback; primary identification is via the
  // confluence-link side file in the arch-tool repo.
  return `<hr/><p style="color:#9ca3af;font-size:11px;">arch-tool-meta:${escapeXml(componentId)}</p>`
}

export interface BuildPageArgs {
  component: Component
  audienceLabel: string
  narrativeMarkdown: string
}

export async function buildPageBody(args: BuildPageArgs): Promise<string> {
  const narrativeStorage = await markdownToStorage(args.narrativeMarkdown)
  return [
    buildHeaderInfo(args.component, args.audienceLabel),
    narrativeStorage,
    buildReferenceSection(args.component),
    buildFooter(args.component.id),
  ].join("\n")
}

export function pageTitleFor(component: Component): string {
  // Confluence page titles must be unique within a space; prefix with the
  // component ID so renames don't break uniqueness.
  return `${component.name} (${component.id})`
}

export function capabilityForHierarchy(component: Component): string {
  // Prefer the new rich capabilities field.
  const caps = component.capabilities || []
  if (caps.length > 0) {
    const first = caps[0].name?.trim()
    if (first) return first
  }
  // Legacy fallback for any unmigrated read path in the same request.
  const legacy =
    (component as { business_capabilities?: string[] }).business_capabilities || []
  return legacy[0]?.trim() || "Uncategorized"
}
