// Data Model Registry provider abstraction.
//
// A generic interface for any REST-based metadata service that exposes
// entity definitions (name + attribute list) and entity-to-entity
// relationships. The shape is intentionally narrow — read-only,
// per-entity lookups — because that is what arch-tool needs to render
// next to a `table`-typed component on its detail page.
//
// One implementation ships in the box (rest.ts). The provider stays
// vendor-neutral: paths, base URL and the active zone are all
// configurable via env vars, and the operator picks between static
// bearer token auth and OAuth 2.0 client_credentials.

import type { ProbeTrace } from "../diagnostics"

export interface EntityAttribute {
  name: string
  type: string
  nullable?: boolean
}

export interface EntityVersion {
  entity: string
  attributes: EntityAttribute[]
  version?: string
  zone?: string
}

export interface EntityRelationship {
  parent: string
  child: string
  type?: string
}

export interface DataModelDescribe {
  baseUrl: string
  apiPath: string
  zone: string
  authScheme: string
  authHint: string
  entityEndpoint: string
  relationshipsEndpoint: string
}

export interface DataModelProvider {
  readonly name: string
  readonly zone: string

  getEntity(entityName: string): Promise<EntityVersion | null>
  getRelationships(entityName: string): Promise<EntityRelationship[]>

  describe(): DataModelDescribe
  probe(): Promise<ProbeTrace>
}
