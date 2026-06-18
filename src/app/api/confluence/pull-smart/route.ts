import { NextResponse } from "next/server"
import yaml from "js-yaml"
import {
  getLLM,
  isLLMConfigured,
  LLM_DISABLED_MESSAGE,
} from "@/lib/llm"
import {
  getComponent,
  saveComponent,
  getConfluenceLink,
  saveConfluenceLink,
} from "@/lib/github"
import { isValidName } from "@/lib/validate"
import {
  isConfluenceConfigured,
  getPage,
  findPageByComponentId,
} from "@/lib/confluence"
import {
  resolveDataClassification,
  resolveScaling,
} from "@/lib/confluence-parse"
import type {
  ComponentNFR,
  ComponentStatus,
  DataClassification,
  ScalingModel,
  ComponentRule,
  RuleKind,
} from "@/lib/types"
import { COMPONENT_STATUSES, RULE_KINDS } from "@/lib/constants"
import { checkRateLimit } from "@/lib/rate-limit"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

type Confidence = "high" | "medium" | "low"

export interface SmartPatch {
  field: string // e.g. "name", "owner", "tags", "description.oneliner", "nfr.availability"
  oldValue: string
  newValue: string
  confidence: Confidence
  evidence?: string // a short quote from the page that supports the change
}

interface PullSmartBody {
  componentId: string
  apply?: boolean
  patches?: SmartPatch[]
}

// Scalar field paths recognised by both proposal and apply phases.
const SCALAR_ALLOWED_FIELDS = new Set<string>([
  "name",
  "status",
  "owner",
  "tags",
  "description.oneliner",
  "description.description",
  // Legacy fields — still accepted from older Confluence pages whose
  // structure has not been re-published since the v0.6 migration. New
  // pages should patch description.description directly.
  "description.technical",
  "description.business",
  "nfr.availability",
  "nfr.rto",
  "nfr.rpo",
  "nfr.max_latency",
  "nfr.throughput",
  "nfr.data_classification",
  "nfr.scaling",
])

// Allowed sub-fields on indexed rule paths (rules[N].<field>).
const ALLOWED_RULE_SUBFIELDS = new Set<string>([
  "name",
  "kind",
  "summary",
  "description",
  "formula",
  "given",
  "when",
  "then",
  "enforced_in",
])

const RULE_PATH_RE = /^rules\[(\d+)\]\.([a-z_]+)$/

function isAllowedField(field: string): boolean {
  if (SCALAR_ALLOWED_FIELDS.has(field)) return true
  const m = field.match(RULE_PATH_RE)
  if (m && ALLOWED_RULE_SUBFIELDS.has(m[2])) return true
  return false
}

// Backwards-compat alias used in places that previously referenced the Set.
const ALLOWED_FIELDS = {
  has: isAllowedField,
}

export async function POST(request: Request) {
  return withRouteContext(request, () => doPost(request))
}

async function doPost(request: Request) {
  try {
    if (!isConfluenceConfigured()) {
      return NextResponse.json(
        { error: "Confluence is not configured." },
        { status: 503 }
      )
    }

    const body = (await request.json()) as PullSmartBody
    const componentId = body.componentId
    if (!componentId || !isValidName(componentId)) {
      return NextResponse.json(
        { error: "Invalid or missing componentId" },
        { status: 400 }
      )
    }

    // Resolve page id (side-file → title fallback).
    let pageId: string | undefined
    let linkSha: string | undefined
    try {
      const link = await getConfluenceLink(componentId)
      if (link) {
        pageId = link.pageId
        linkSha = link.sha
      }
    } catch {
      // ignore
    }
    if (!pageId) {
      const found = await findPageByComponentId(componentId)
      if (found) pageId = found.id
    }
    if (!pageId) {
      return NextResponse.json(
        { error: "Component has not been published to Confluence yet." },
        { status: 404 }
      )
    }

    const page = await getPage(pageId)
    const component = await getComponent(componentId)

    if (body.apply) {
      const patches = body.patches || []
      return await applyPatches({
        componentId,
        component,
        patches,
        pageId,
        linkSha,
        pageVersion: page.version.number,
        pageSpaceId: page.spaceId,
      })
    }

    // PROPOSE phase: AI scans the whole page text against the catalog YAML
    // and proposes precise field-level patches.
    if (!isLLMConfigured()) {
      return NextResponse.json(
        { error: LLM_DISABLED_MESSAGE },
        { status: 503 }
      )
    }
    const clientIp = request.headers.get("x-forwarded-for") || "unknown"
    if (!checkRateLimit(clientIp)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a minute." },
        { status: 429 }
      )
    }

    const aiPatches = await computeAiPatches(page.body, component)

    return NextResponse.json({
      patches: aiPatches,
      confluenceVersion: page.version.number,
      confluenceUrl: page.fullUrl,
    })
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : error && typeof error === "object" && "message" in error
        ? String((error as { message: string }).message)
        : "Unknown error"
    getLogger().error("Failed pull-smart", { err: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function computeAiPatches(
  storageBody: string,
  component: unknown
): Promise<SmartPatch[]> {
  if (!isLLMConfigured()) return []
  const llm = await getLLM()
  const pageText = storageToText(storageBody)
  const yamlText = yaml.dump(component, { lineWidth: -1, sortKeys: false })
  const prompt = buildPrompt(yamlText, pageText)

  try {
    const raw = await llm.complete({ prompt, maxTokens: 1500 })
    const parsed = extractJson(raw)
    if (!parsed || !Array.isArray(parsed.patches)) return []
    const out: SmartPatch[] = []
    for (const raw of parsed.patches) {
      const p = raw as {
        field?: unknown
        oldValue?: unknown
        newValue?: unknown
        confidence?: unknown
        evidence?: unknown
      }
      if (
        typeof p?.field === "string" &&
        ALLOWED_FIELDS.has(p.field) &&
        typeof p.newValue !== "undefined"
      ) {
        const conf = p.confidence
        const confidence: Confidence =
          conf === "high" || conf === "medium" || conf === "low" ? conf : "medium"
        out.push({
          field: p.field,
          oldValue:
            typeof p.oldValue === "string" ? p.oldValue : String(p.oldValue ?? ""),
          newValue:
            typeof p.newValue === "string" ? p.newValue : String(p.newValue ?? ""),
          confidence,
          evidence:
            typeof p.evidence === "string" ? p.evidence.slice(0, 240) : undefined,
        })
      }
    }
    return out
  } catch (err) {
    getLogger().warn("AI scan failed", { err: err instanceof Error ? err.message : String(err) })
    return []
  }
}

function storageToText(storage: string): string {
  // Convert Confluence storage XHTML to readable text:
  //   - render <ac:structured-macro ac:name="code"> blocks as fenced code
  //   - drop other ac:/ri: macros
  //   - convert headings to "# ..." prefixes
  //   - convert tables to "Field: Value" lines (best-effort)
  //   - strip remaining tags
  //   - decode entities
  let s = storage

  // Replace code macros with fenced code blocks.
  s = s.replace(
    /<ac:structured-macro[^>]*ac:name=["']code["'][^>]*>([\s\S]*?)<\/ac:structured-macro>/g,
    (_, inner) => {
      const langMatch = inner.match(
        /<ac:parameter[^>]*ac:name=["']language["'][^>]*>([^<]*)<\/ac:parameter>/
      )
      const bodyMatch = inner.match(
        /<ac:plain-text-body[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/
      )
      const lang = langMatch ? langMatch[1] : ""
      const body = bodyMatch ? bodyMatch[1] : ""
      return `\n\`\`\`${lang}\n${body}\n\`\`\`\n`
    }
  )
  // Drop info / note / etc. macros but keep their inner text.
  s = s.replace(
    /<ac:structured-macro[^>]*>([\s\S]*?)<\/ac:structured-macro>/g,
    (_, inner) => inner
  )
  // Drop self-closing macros entirely.
  s = s.replace(/<ac:[^>]*\/>/g, "")
  s = s.replace(/<ri:[^>]*\/?>/g, "")
  // Convert headings.
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g, (_, lvl, inner) => {
    const hashes = "#".repeat(Number(lvl))
    return `\n${hashes} ${stripInlineTags(inner).trim()}\n`
  })
  // Convert table rows of th/td to "label: value".
  s = s.replace(
    /<tr[^>]*>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g,
    (_, th, td) => `\n${stripInlineTags(th).trim()}: ${stripInlineTags(td).trim()}`
  )
  // Convert list items.
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/g, (_, inner) => `\n- ${stripInlineTags(inner).trim()}`)
  // Paragraphs → blank lines.
  s = s.replace(/<\/p>\s*<p[^>]*>/g, "\n\n")
  s = s.replace(/<\/?p[^>]*>/g, "\n")
  // Line breaks.
  s = s.replace(/<br\s*\/?>/g, "\n")
  // Strip remaining tags.
  s = stripInlineTags(s)
  // Decode entities.
  s = decodeEntities(s)
  // Collapse runs of blank lines.
  s = s.replace(/\n{3,}/g, "\n\n").trim()
  return s.slice(0, 30000)
}

function stripInlineTags(s: string): string {
  // Loop until idempotent so nested/malformed fragments like "<<b>foo>"
  // don't survive a single pass (codeql: js/incomplete-multi-character-sanitization).
  let prev: string
  let cur = s
  do {
    prev = cur
    cur = cur.replace(/<[^>]+>/g, "")
  } while (cur !== prev)
  return cur
}

function decodeEntities(s: string): string {
  // Decode `&amp;` LAST so `&amp;lt;` stays as `&lt;` instead of collapsing
  // to `<` (codeql: js/double-escaping).
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&middot;/g, "·")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&amp;/g, "&")
}

function extractJson(raw: string): { patches?: unknown[] } | null {
  // Tolerate fenced code blocks around the JSON.
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fence ? fence[1] : raw
  // Find the first { and last } to be tolerant of preface/suffix.
  const first = candidate.indexOf("{")
  const last = candidate.lastIndexOf("}")
  if (first === -1 || last === -1 || last < first) return null
  try {
    return JSON.parse(candidate.slice(first, last + 1))
  } catch {
    return null
  }
}

function buildPrompt(componentYaml: string, pageText: string): string {
  return `You are an architecture catalog change-detection agent.

A team has a component definition stored as YAML (the catalog source of truth) and a corresponding Confluence page. Users sometimes edit the Confluence page anywhere — the Properties table, the narrative chapters, or even comments — and the catalog must reflect those edits.

Your job: compare the current Confluence page to the YAML and propose precise field-level changes the user might want to apply back.

CATALOG YAML (current source of truth):
\`\`\`yaml
${componentYaml.slice(0, 8000)}
\`\`\`

CONFLUENCE PAGE TEXT (extracted from storage format):
\`\`\`
${pageText}
\`\`\`

EDITABLE FIELDS (only propose changes to these — use these exact dot-paths):
- name (string)
- status: must be "draft", "production", or "deprecated"
- owner (string)
- tags (array of strings — return as a comma-separated string in newValue)
- description.oneliner (string, short summary)
- description.description (string, the unified long-form description — use this for any new description content)
- description.technical (string, legacy — only patch when the Confluence page still has a "Technical" section; new pages should patch description.description instead)
- description.business (string, legacy — only patch when the Confluence page still has a "Business" section; new pages should patch description.description instead)
- nfr.availability (string, e.g. "99.9%")
- nfr.rto (string, e.g. "1h")
- nfr.rpo (string)
- nfr.max_latency (string)
- nfr.throughput (string)
- nfr.data_classification: must be "public", "internal", "confidential", or "restricted"
- nfr.scaling: must be "horizontal", "vertical", or "none"

INDEXED RULE FIELDS (use the exact 0-based index of the rule as it appears in the YAML's "rules" array):
- rules[N].name (string)
- rules[N].kind: must be "formula", "rule", or "constraint"
- rules[N].summary (string, one-line)
- rules[N].description (string, may be multi-line; preserve newlines as \\n in the JSON value)
- rules[N].formula (string — propose only when the existing rule's kind is "formula")
- rules[N].given (string — propose only when the rule's kind is "rule")
- rules[N].when (string — propose only when the rule's kind is "rule")
- rules[N].then (string — propose only when the rule's kind is "rule")
- rules[N].enforced_in (comma-separated component ids — propose only when the rule's kind is "constraint")

The published Confluence page renders each rule as a coloured panel ("Per-tier rate limit · Formula", "Throttle policy-holders under fraud review · Rule", etc.) below a "Business Rules & Calculations" heading. The order on the page matches the order in the YAML, so rules[0] is the first panel under Formulas, then numbering continues across kinds in YAML order.

RULES:
- Only propose a change when the page has clear evidence of a value different from the YAML.
- Do NOT propose unchanged fields.
- Do NOT invent values. If uncertain, set confidence "low".
- For enum-constrained fields (status, nfr.data_classification, nfr.scaling), the new value MUST be a valid enum value. If the user wrote something invalid, omit that proposal.
- For description.technical and description.business: only propose changes if the user has clearly rewritten substantial portions of the prose. Trivial wording differences should be ignored.
- Provide a short "evidence" quote from the page (one sentence, max 200 chars) so the user can verify.
- Confidence: "high" when wording is unambiguous and explicit (e.g., a property labelled clearly), "medium" when reasonably implied, "low" when speculative.

Output ONLY a single JSON object with this exact shape:
{
  "patches": [
    {
      "field": "<dot-path>",
      "oldValue": "<current YAML value, stringified>",
      "newValue": "<proposed value, stringified>",
      "confidence": "high" | "medium" | "low",
      "evidence": "<short page quote>"
    }
  ]
}

If there are no changes, return {"patches": []}.
Output JSON only, no surrounding prose, no markdown fences.`
}

interface ApplyArgs {
  componentId: string
  component: Awaited<ReturnType<typeof getComponent>>
  patches: SmartPatch[]
  pageId: string
  linkSha?: string
  pageVersion: number
  pageSpaceId: string
}

async function applyPatches(args: ApplyArgs): Promise<NextResponse> {
  const { component, patches } = args

  // Validate enums up front; return 400 if any invalid.
  for (const p of patches) {
    if (!ALLOWED_FIELDS.has(p.field)) {
      return NextResponse.json(
        { error: `Field "${p.field}" is not editable.` },
        { status: 400 }
      )
    }
    if (
      p.field === "status" &&
      p.newValue &&
      !COMPONENT_STATUSES.includes(p.newValue as ComponentStatus)
    ) {
      return NextResponse.json(
        {
          error: `Invalid status "${p.newValue}". Must be one of: ${COMPONENT_STATUSES.join(", ")}.`,
        },
        { status: 400 }
      )
    }
    if (p.field === "nfr.data_classification" && p.newValue) {
      if (resolveDataClassification(p.newValue) === null) {
        return NextResponse.json(
          {
            error: `Invalid Data Classification "${p.newValue}". Must be public, internal, confidential, or restricted.`,
          },
          { status: 400 }
        )
      }
    }
    if (p.field === "nfr.scaling" && p.newValue) {
      if (resolveScaling(p.newValue) === null) {
        return NextResponse.json(
          {
            error: `Invalid Scaling Model "${p.newValue}". Must be horizontal, vertical, or none.`,
          },
          { status: 400 }
        )
      }
    }
    // Validate indexed rule patches: index in bounds + kind enum.
    const ruleMatch = p.field.match(RULE_PATH_RE)
    if (ruleMatch) {
      const idx = Number(ruleMatch[1])
      const sub = ruleMatch[2]
      const rules = component.rules || []
      if (idx < 0 || idx >= rules.length) {
        return NextResponse.json(
          {
            error: `Rule index out of bounds: ${p.field}. Component has ${rules.length} rules; valid indices are 0..${rules.length - 1}.`,
          },
          { status: 400 }
        )
      }
      if (sub === "kind" && p.newValue && !RULE_KINDS.includes(p.newValue as RuleKind)) {
        return NextResponse.json(
          {
            error: `Invalid rule kind "${p.newValue}". Must be one of: ${RULE_KINDS.join(", ")}.`,
          },
          { status: 400 }
        )
      }
    }
  }

  // Build merged component.
  const { sha: componentSha, ...rest } = component
  const updated: Record<string, unknown> = { ...rest }
  // Ensure nested objects exist.
  updated.description = { ...(component.description || { oneliner: "", technical: "", business: "" }) }
  const mergedNfr: ComponentNFR = { ...(component.nfr || {}) }
  // Deep-clone the rules array so we can mutate per index without aliasing.
  const mergedRules: ComponentRule[] = (component.rules || []).map((r) => ({ ...r }))

  for (const p of patches) {
    const v = p.newValue
    // Indexed rule patches: rules[N].<field>
    const ruleMatch = p.field.match(RULE_PATH_RE)
    if (ruleMatch) {
      const idx = Number(ruleMatch[1])
      const sub = ruleMatch[2] as keyof ComponentRule
      const rule = mergedRules[idx]
      if (!rule) continue // already validated; defensive
      if (sub === "enforced_in") {
        const ids = v
          ? v.split(",").map((s) => s.trim()).filter(Boolean)
          : []
        if (ids.length > 0) rule.enforced_in = ids
        else delete rule.enforced_in
      } else if (sub === "kind") {
        if (v) rule.kind = v as RuleKind
      } else {
        // Plain string fields: name, summary, description, formula, given, when, then.
        const ruleAsRecord = rule as unknown as Record<string, unknown>
        if (v === "") delete ruleAsRecord[sub as string]
        else ruleAsRecord[sub as string] = v
      }
      continue
    }
    switch (p.field) {
      case "name":
        updated.name = v
        break
      case "status":
        if (v) updated.status = v as ComponentStatus
        break
      case "owner":
        updated.owner = v
        break
      case "tags":
        updated.tags = v
          ? v
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : []
        break
      case "description.oneliner":
        ;(updated.description as Record<string, string>).oneliner = v
        break
      case "description.description":
        ;(updated.description as Record<string, string>).description = v
        break
      case "description.technical":
        ;(updated.description as Record<string, string>).technical = v
        break
      case "description.business":
        ;(updated.description as Record<string, string>).business = v
        break
      case "nfr.availability":
      case "nfr.rto":
      case "nfr.rpo":
      case "nfr.max_latency":
      case "nfr.throughput": {
        const key = p.field.split(".")[1] as keyof ComponentNFR
        if (v === "") delete mergedNfr[key]
        else (mergedNfr as Record<string, unknown>)[key] = v
        break
      }
      case "nfr.data_classification": {
        const resolved = v ? resolveDataClassification(v) : undefined
        if (!v || resolved === undefined) delete mergedNfr.data_classification
        else if (resolved) mergedNfr.data_classification = resolved as DataClassification
        break
      }
      case "nfr.scaling": {
        const resolved = v ? resolveScaling(v) : undefined
        if (!v || resolved === undefined) delete mergedNfr.scaling
        else if (resolved) mergedNfr.scaling = resolved as ScalingModel
        break
      }
    }
  }

  if (Object.keys(mergedNfr).length > 0) {
    updated.nfr = mergedNfr
  } else {
    delete updated.nfr
  }

  if (mergedRules.length > 0) {
    updated.rules = mergedRules
  } else {
    delete updated.rules
  }

  // Strip any leftover sha from spread (already handled but defensive).
  delete (updated as Record<string, unknown>).sha

  await saveComponent(
    updated as unknown as Parameters<typeof saveComponent>[0],
    componentSha
  )

  // Best-effort side-file refresh.
  try {
    await saveConfluenceLink(
      {
        componentId: args.componentId,
        pageId: args.pageId,
        spaceId: args.pageSpaceId,
        lastSyncedAt: new Date().toISOString(),
        lastPublishedVersion: args.pageVersion,
      },
      args.linkSha
    )
  } catch (err) {
    getLogger().warn(`saveConfluenceLink failed for ${args.componentId} (apply still succeeded)`, {
      err: err instanceof Error ? err.message : String(err),
    })
  }

  return NextResponse.json({
    applied: true,
    appliedCount: patches.length,
    confluenceVersion: args.pageVersion,
  })
}
