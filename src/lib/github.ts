// Domain store: components, diagrams and Confluence link side-files.
//
// Stays under the historical filename `github.ts` so the 12 API route
// imports keep working, but the implementation is now backend-agnostic —
// it routes every read and write through the GitProvider selected via the
// GIT_PROVIDER env var (see src/lib/git/index.ts). Today that means
// GitHub or Azure DevOps; new backends slot in without touching this
// layer.

import yaml from "js-yaml"
import { getGit, GitNotFoundError } from "./git"
import { componentToYaml } from "./component-yaml"
import type {
  Component,
  ComponentWithSha,
  ComponentLink,
  DiagramWithSha,
  LinkRole,
  LinkProtocol,
  RelationshipType,
} from "./types"
import { getLogger } from "./log"

// Backward compatibility for legacy YAML shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateComponent(raw: Record<string, any>): Component {
  // Old `dependencies` array → new `relationships` format.
  if (raw.dependencies && Array.isArray(raw.dependencies) && !raw.relationships) {
    raw.relationships = raw.dependencies.map((dep: { id: string; connector?: string }) => ({
      target: dep.id,
      type: "depends-on" as const,
      connector: dep.connector,
    }))
    delete raw.dependencies
  }
  if (!raw.relationships) {
    raw.relationships = []
  }
  // Old `business_capabilities: string[]` → new `capabilities: { name, role }[]`.
  // Conservative default role "indirect" because legacy data carried no role info.
  if (
    Array.isArray(raw.business_capabilities) &&
    !Array.isArray(raw.capabilities)
  ) {
    raw.capabilities = raw.business_capabilities
      .filter((n: unknown) => typeof n === "string" && n.trim().length > 0)
      .map((name: string) => ({
        name,
        role: "indirect" as const,
      }))
    delete raw.business_capabilities
  }
  // Old `data.consumes` / `data.produces` → new `data.inputs` / `data.outputs`.
  // Renamed to make the input/output dimension obvious to BAs and DEVs alike.
  if (raw.data && typeof raw.data === "object") {
    if (Array.isArray(raw.data.consumes) && !Array.isArray(raw.data.inputs)) {
      raw.data.inputs = raw.data.consumes
      delete raw.data.consumes
    }
    if (Array.isArray(raw.data.produces) && !Array.isArray(raw.data.outputs)) {
      raw.data.outputs = raw.data.produces
      delete raw.data.produces
    }
  }
  // Description: legacy YAML kept `technical` + `business` as two
  // separate sections. New code uses a single `description` field. To
  // keep old files loading unchanged, backfill `description` from
  // technical + business at read time. The form sees one merged
  // textarea; the next save persists only the unified field, dropping
  // the legacy ones. Components that only set `technical` keep its
  // content; ones that set both get them joined.
  if (raw.description && typeof raw.description === "object") {
    const d = raw.description as Record<string, unknown>
    if (typeof d.description !== "string" || !d.description) {
      const tech = typeof d.technical === "string" ? d.technical : ""
      const biz = typeof d.business === "string" ? d.business : ""
      if (tech && biz && tech.trim() !== biz.trim()) {
        d.description = `${tech.trim()}\n\n${biz.trim()}`
      } else if (tech) {
        d.description = tech
      } else if (biz) {
        d.description = biz
      }
    }
  }

  // ---- v2: collapse interfaces + relationships into links[] ----
  //
  // Always idempotent: a YAML already at schema_version >= 2 still
  // gets a no-op pass (no legacy fields to migrate). The legacy
  // fields are removed from the in-memory object so neither the form
  // nor the detail page can accidentally render them; the next save
  // therefore drops them from disk too.
  migrateToLinksV2(raw)

  return raw as Component
}

// Translate one legacy relationship type to a v2 link role. Used by
// both the read-time migration below and by the consistency check's
// internal mapping.
function relationshipTypeToLinkRole(t: RelationshipType): LinkRole {
  switch (t) {
    case "parent-of":
      return "contains"
    case "child-of":
      return "part-of"
    case "depends-on":
      return "calls"
    case "communicates-with":
      return "calls"
    case "reads-from":
      return "reads-from"
    case "writes-to":
      return "writes-to"
    case "fallback":
      return "calls"
  }
}

function relationshipTypeDescription(
  t: RelationshipType,
  existing: string | undefined
): string | undefined {
  // Preserve the original description when set; otherwise hint at
  // the legacy semantic so v1 nuance ("fallback for", "communicates
  // with") is not silently lost.
  if (existing && existing.trim()) return existing
  switch (t) {
    case "communicates-with":
      return "Communicates with (bidirectional)"
    case "fallback":
      return "Fallback / backup"
    case "depends-on":
      return "Depends on"
    default:
      return undefined
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateToLinksV2(raw: Record<string, any>): void {
  const existingLinks: ComponentLink[] = Array.isArray(raw.links)
    ? (raw.links as ComponentLink[])
    : []
  const out: ComponentLink[] = [...existingLinks]

  // Dedupe key on (target, role, protocol?, name?) so an entry that
  // was already moved to links by a previous save does not get
  // duplicated by a still-present legacy entry that someone manually
  // re-pasted. The name field is part of the key so two data items
  // flowing from B to A on the same role (e.g. two writes-to with
  // different `name`) stay as two distinct edges.
  const seen = new Set(
    out.map(
      (l) => `${l.target}::${l.role}::${l.protocol ?? ""}::${l.name ?? ""}`
    )
  )
  const push = (l: ComponentLink) => {
    const key = `${l.target}::${l.role}::${l.protocol ?? ""}::${l.name ?? ""}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(l)
  }

  // interfaces[] → calls / serves
  if (Array.isArray(raw.interfaces)) {
    for (const iface of raw.interfaces) {
      if (!iface || typeof iface !== "object") continue
      const target = typeof iface.target === "string" ? iface.target : ""
      if (!target) continue
      const role: LinkRole =
        iface.direction === "provides" ? "serves" : "calls"
      const link: ComponentLink = { target, role }
      if (typeof iface.type === "string") link.protocol = iface.type as LinkProtocol
      if (typeof iface.name === "string" && iface.name.trim()) link.name = iface.name
      if (typeof iface.description === "string" && iface.description.trim())
        link.description = iface.description
      push(link)
    }
  }

  // relationships[] → mapped roles
  if (Array.isArray(raw.relationships)) {
    for (const rel of raw.relationships) {
      if (!rel || typeof rel !== "object") continue
      const target = typeof rel.target === "string" ? rel.target : ""
      if (!target) continue
      const t = rel.type as RelationshipType
      const role = relationshipTypeToLinkRole(t)
      const link: ComponentLink = { target, role }
      if (typeof rel.connector === "string" && rel.connector.trim())
        link.protocol = rel.connector as LinkProtocol
      const desc = relationshipTypeDescription(
        t,
        typeof rel.description === "string" ? rel.description : undefined
      )
      if (desc) link.description = desc
      push(link)
    }
  }

  // v2 Phase 2: data{} → links[] using reads-from / writes-to roles.
  //
  //   data.inputs[name=X, source=B, purpose=P]
  //     → links[reads-from B, name=X, description=P]
  //
  //   data.outputs[name=X, consumers=[B,C], purpose=P]
  //     → 2 links: writes-to B name=X, writes-to C name=X
  //
  //   data.owns  → DROPPED (per Phase 2 spec: "source-of-truth" is
  //                not an edge to another component; the analyst
  //                expresses it via tags / capabilities going forward).
  //
  // DataKind on the legacy DataItem is intentionally NOT preserved
  // — the 16-value ontology disappears in v2; only name + purpose
  // (as description) carry over.
  if (raw.data && typeof raw.data === "object") {
    if (Array.isArray(raw.data.inputs)) {
      for (const item of raw.data.inputs) {
        if (!item || typeof item !== "object") continue
        const source = typeof item.source === "string" ? item.source : ""
        if (!source) continue // orphan input (no source) — dropped per agreed spec
        const link: ComponentLink = { target: source, role: "reads-from" }
        if (typeof item.name === "string" && item.name.trim()) link.name = item.name
        const desc =
          (typeof item.purpose === "string" && item.purpose.trim()) ||
          (typeof item.description === "string" && item.description.trim()) ||
          ""
        if (desc) link.description = desc
        push(link)
      }
    }
    if (Array.isArray(raw.data.outputs)) {
      for (const item of raw.data.outputs) {
        if (!item || typeof item !== "object") continue
        const consumers: string[] = Array.isArray(item.consumers)
          ? (item.consumers.filter(
              (c: unknown) => typeof c === "string" && c.trim()
            ) as string[])
          : []
        if (consumers.length === 0) continue // no consumers — drop
        const desc =
          (typeof item.purpose === "string" && item.purpose.trim()) ||
          (typeof item.description === "string" && item.description.trim()) ||
          ""
        for (const c of consumers) {
          const link: ComponentLink = { target: c, role: "writes-to" }
          if (typeof item.name === "string" && item.name.trim()) link.name = item.name
          if (desc) link.description = desc
          push(link)
        }
      }
    }
    // data.owns intentionally skipped.
  }

  // Always commit the merged list, even when it equals the existing
  // one — keeps schema_version invariant after a no-op pass.
  raw.links = out
  raw.schema_version = 2

  // Drop legacy in-memory so downstream code (form, detail page,
  // consistency check, mermaid builders) sees a clean v2 object.
  delete raw.interfaces
  delete raw.relationships
  delete raw.data
}

export async function listComponents(): Promise<Component[]> {
  const git = getGit()
  const entries = await git.listTree("components/")
  const yamlFiles = entries.filter((e) => e.path.endsWith(".yaml"))

  const components = await Promise.all(
    yamlFiles.map(async (file) => {
      try {
        const content = await git.getBlob(file.sha)
        return migrateComponent(
          yaml.load(content, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>
        )
      } catch (err) {
        getLogger().error(`Failed to fetch component ${file.path}`, {
          err: err instanceof Error ? err.message : String(err),
        })
        return null
      }
    })
  )

  return components.filter(Boolean) as Component[]
}

export async function getComponent(id: string): Promise<ComponentWithSha> {
  const git = getGit()
  const file = await git.getFile(`components/${id}.yaml`)
  const component = migrateComponent(
    yaml.load(file.content, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>
  )
  return { ...component, sha: file.sha }
}

export async function saveComponent(
  component: Component,
  sha?: string
): Promise<void> {
  const git = getGit()
  const path = `components/${component.id}.yaml`
  // Defensive: normalise to v2 shape before serialising. The form
  // should already hand us a v2 object (links[] populated, no legacy
  // fields), but consistency-check fixes and the import dialog can
  // emit either shape, so stripping here is the single chokepoint
  // that guarantees disk converges to v2 over time.
  const content = componentToYaml(component)
  const message = sha
    ? `feat: update component ${component.id}`
    : `feat: add component ${component.id}`
  await git.putFile(path, content, message, sha)
}

export async function deleteComponent(id: string, sha: string): Promise<void> {
  const git = getGit()
  await git.deleteFile(
    `components/${id}.yaml`,
    sha,
    `feat: remove component ${id}`
  )
}

// Component history

export interface ComponentCommit {
  sha: string
  message: string
  author: string
  date: string
}

export async function getComponentHistory(id: string): Promise<ComponentCommit[]> {
  const git = getGit()
  return git.listFileHistory(`components/${id}.yaml`, 50)
}

// Diagrams

export async function listDiagrams(): Promise<DiagramWithSha[]> {
  const git = getGit()
  const entries = await git.listTree("diagrams/")
  const drawioFiles = entries.filter((e) => e.path.endsWith(".drawio"))

  const diagrams = await Promise.all(
    drawioFiles.map(async (file) => {
      try {
        const content = await git.getBlob(file.sha)
        const name = file.path.replace("diagrams/", "").replace(".drawio", "")
        return { name, content, sha: file.sha } as DiagramWithSha
      } catch (err) {
        getLogger().error(`Failed to fetch diagram ${file.path}`, {
          err: err instanceof Error ? err.message : String(err),
        })
        return null
      }
    })
  )

  return diagrams.filter(Boolean) as DiagramWithSha[]
}

export async function saveDiagram(
  name: string,
  content: string,
  sha?: string
): Promise<void> {
  const git = getGit()
  const path = `diagrams/${name}.drawio`
  const message = sha
    ? `feat: update diagram ${name}`
    : `feat: add diagram ${name}`
  await git.putFile(path, content, message, sha)
}

export async function getDiagram(name: string): Promise<DiagramWithSha> {
  const git = getGit()
  const file = await git.getFile(`diagrams/${name}.drawio`)
  return { name, content: file.content, sha: file.sha }
}

export async function deleteDiagram(name: string, sha: string): Promise<void> {
  const git = getGit()
  await git.deleteFile(
    `diagrams/${name}.drawio`,
    sha,
    `feat: remove diagram ${name}`
  )
}

// Confluence link side-file: maps a component to a Confluence page so that
// publish/pull stays stable even if the component is renamed.

export interface ConfluenceLink {
  componentId: string
  pageId: string
  spaceId: string
  lastSyncedAt: string
  lastPublishedVersion?: number
}

interface ConfluenceLinkWithSha extends ConfluenceLink {
  sha: string
}

export async function getConfluenceLink(
  componentId: string
): Promise<ConfluenceLinkWithSha | null> {
  const git = getGit()
  try {
    const file = await git.getFile(`confluence-links/${componentId}.json`)
    return { ...(JSON.parse(file.content) as ConfluenceLink), sha: file.sha }
  } catch (error: unknown) {
    if (error instanceof GitNotFoundError) return null
    throw error
  }
}

export async function saveConfluenceLink(
  link: ConfluenceLink,
  sha?: string
): Promise<void> {
  const git = getGit()
  const path = `confluence-links/${link.componentId}.json`
  const content = JSON.stringify(link, null, 2) + "\n"
  const message = sha
    ? `chore: update confluence link for ${link.componentId}`
    : `chore: add confluence link for ${link.componentId}`
  await git.putFile(path, content, message, sha)
}
