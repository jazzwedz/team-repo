# arch-tool — Component Data Model

> **Audience.** LLMs and humans authoring or transforming component
> YAML for the `arch-tool` Team Repository catalog. This document is
> the canonical, self-contained schema reference — pass it as a system
> prompt to any model that needs to produce, validate or migrate
> components and it will have everything it needs.
>
> **Storage.** Each component is one YAML file at
> `components/<id>.yaml` in the repository the tool is pointed at.
> The repo is the source of truth; the UI is a read/write view on it.
>
> **Schema version.** This document describes **schema v2**. Every
> edge between components — API calls, containment, data flow — is a
> single `links[]` primitive. The legacy v1 containers (`interfaces[]`,
> `relationships[]`, `data{}`) still parse on read but are migrated to
> `links[]` in memory and dropped from disk on the next save (see §11).
> New YAML should write `links[]` only.
>
> **Versioning behaviour.** Permissive on read (legacy shapes
> auto-migrate), clean on write (saves drop deprecated fields and stamp
> `schema_version: 2`). A component that has never been re-saved since a
> migration still renders correctly thanks to the read-time migration
> layer.

---

## 1. Top-level Component

```ts
interface Component {
  // On-disk schema version. Stamped to 2 on every save; the read-time
  // migration sets it to 2 in memory whenever it populates links[].
  schema_version?: number             // 2 for current; undefined/1 = legacy

  // Identity ----------------------------------------------------------
  id: string                          // kebab-case slug; required on disk
  name: string                        // human-readable; THE only required field on create
  type: ComponentType                 // default "component" — see §3
  status: ComponentStatus             // default "draft" — see §4
  owner: string                       // free-form (team / role)
  tags: string[]                      // free-form, kebab-case convention

  // Narrative --------------------------------------------------------
  description: ComponentDescription   // unified prose; see §2

  // Architectural shape (v2) -----------------------------------------
  links?: ComponentLink[]             // EVERY edge to another component — see §6

  // Business framing -------------------------------------------------
  capabilities?: ComponentCapability[]    // see §7
  processes?: ComponentProcess[]          // see §8
  rules?: ComponentRule[]                 // formulas / rules / constraints — see §9
  risks?: string[]                        // free-form bullet list

  // Non-functional & ops ---------------------------------------------
  nfr?: ComponentNFR                  // see §10
  diagram?: ComponentDiagram          // visual overrides — see §10.1

  // External registry link (type-restricted) -------------------------
  data_model?: ComponentDataModelLink // only meaningful when type === "table" — see §5

  // Legacy (read-only — migrated to links[], see §11) ----------------
  interfaces?: ComponentInterface[]   // → links[] (calls / serves)
  relationships?: ComponentRelationship[] // → links[] (mapped roles)
  data?: ComponentData                // → links[] (reads-from / writes-to)
  business_capabilities?: string[]    // → capabilities[]
}
```

### 1.1 Required vs optional, defaults

| Field | Required | Default | Notes |
|---|---|---|---|
| `name` | **yes** | — | Free-form, single line |
| `id` | yes on disk | slug of `name` | Auto-generated when omitted on create; immutable in edit |
| `type` | no | `"component"` | One of 20 — see §3 |
| `status` | no | `"draft"` | One of 3 — see §4 |
| `owner` | no | `""` | Free-form |
| `tags` | no | `[]` | string[] |
| `description.description` | no | `""` | Unified narrative |
| `links` | no | `[]` | Every edge — see §6 |
| `schema_version` | no | `2` on save | You may omit it; the save stamps it |
| All others | no | `undefined` | Dropped from saved YAML when empty |

### 1.2 Validation rules enforced by `src/lib/component-schema.ts`

- `name` must be a non-empty string.
- `id` must match `^[a-zA-Z0-9_\-. ]+$` and contain no `..`.
- `type`, `status`, `links[].role`, `links[].protocol`,
  `capabilities[].role`, `processes[].role`, `rules[].kind`,
  `nfr.data_classification`, `nfr.scaling` must match their enum
  (errors otherwise).
- `links[].target` is required and non-empty; `links[].role` is required.
- `data_model` on a `type !== "table"` component → **warning**, not error.
- Unknown top-level or sub-keys → **warning**, ignored on save.
- Legacy fields (`interfaces`, `relationships`, `data`,
  `business_capabilities`) still validate but emit a warning that they
  will migrate to the canonical shape on read/save.

---

## 2. ComponentDescription

```ts
interface ComponentDescription {
  description?: string                // unified long-form prose (THE one to write)

  // Legacy — auto-migrated at read time, dropped on next save
  oneliner?: string                   // historic card subtitle (still read)
  technical?: string                  // historic split → merged into description
  business?: string                   // historic split → merged into description
}
```

**Rule.** `description.description` is the canonical field. The legacy
`technical` + `business` split merges into the unified field on read
(joined with a blank line when both differ); new YAML writes only
`description.description`.

---

## 3. ComponentType — 20 values

The catalog organises types into three families:

### 3.1 Org hierarchy (deployment / ownership tree)

```
Boundary
└─ Context
   ├─ Application      ← Module
   ├─ Microservice     ← Module
   └─ Service          ← Module
```

| `type` | Use case |
|---|---|
| `boundary` | Security / network zone (DMZ, VPC, trust boundary) |
| `context` | Business domain or DDD bounded context |
| `application` | Monolith or COTS product |
| `microservice` | Independently deployable service |
| `service` | Generic service when "microservice" is too strict |
| `module` | Logical unit inside an application / microservice / service |

### 3.2 Data hierarchy (storage tree)

```
Database
└─ Schema             ← also valid standalone as message / API contract
   └─ Table
```

| `type` | Use case |
|---|---|
| `database` | Persistent data store (RDBMS / document / KV at the engine level) |
| `schema` | Database schema / namespace OR JSON / Avro / Protobuf / OpenAPI contract |
| `table` | Table / collection / entity inside a schema or database |

### 3.3 Standalone — no required parent/child

| `type` | Use case |
|---|---|
| `component` | **Default catch-all.** Use when none of the more specific types fits. |
| `frontend` | Web or mobile UI |
| `cache` | In-memory data layer (Redis, in-proc cache) |
| `queue` | Message broker / event bus (Kafka, RabbitMQ, SQS) |
| `data-pipeline` | ETL / streaming processing |
| `batch-job` | Scheduled processing (cron, Airflow DAG) |
| `storage` | Blob / file / object storage (S3, GCS, NFS) |
| `gateway` | API gateway / integration point |
| `external` | Third-party system outside the org's control |
| `platform` | Shared infrastructure platform (k8s cluster, IaaS tenant) |
| `library` | Shared code / SDK |

### 3.4 Picker order (used by the form's default dropdown)

```
component, service, microservice, frontend,
database, table, schema, cache, queue,
data-pipeline, batch-job, storage,
gateway, external, platform, library,
context, boundary, application, module
```

---

## 4. ComponentStatus

```ts
type ComponentStatus = "draft" | "production" | "deprecated"
```

| value | meaning |
|---|---|
| `draft` | Under design / not yet live (default for new entries) |
| `production` | Live, actively maintained |
| `deprecated` | Still exists but being phased out |

---

## 5. ComponentDataModelLink (only on `type: table`)

```ts
interface ComponentDataModelLink {
  entity: string                      // entity name in the external data model registry
}
```

When configured (via env vars `DATA_MODEL_REGISTRY_*`), the detail
page fetches the entity's attributes and relationships **live** from
the registry. Catalog never copies them into the YAML — registry
remains the source of truth.

---

## 6. ComponentLink — the single edge primitive

`links[]` is how a component connects to everything else: APIs it
exposes or consumes, the container it lives in, the data it reads and
writes. One shape covers all of it.

```ts
interface ComponentLink {
  target: string                      // component id OR free-form external label
  role: LinkRole                      // what KIND of edge — see §6.1
  protocol?: LinkProtocol             // HOW it travels — see §6.2 (usually omitted for part-of/contains)
  name?: string                       // short human label ("Orders API", "OrderCreated")
  description?: string                // what happens on this edge
}
```

### 6.1 LinkRole — 6 values, 3 mirror pairs

```ts
type LinkRole = "calls" | "serves" | "part-of" | "contains" | "reads-from" | "writes-to"
```

| `role` | Reads as | Mirror inverse | Typical protocol |
|---|---|---|---|
| `calls` | This actively calls / consumes from target | `serves` | `rest` / `grpc` / `async` |
| `serves` | This exposes / provides to target | `calls` | `rest` / `grpc` / `async` |
| `part-of` | This is contained in target | `contains` | usually omitted |
| `contains` | This contains target | `part-of` | usually omitted |
| `reads-from` | This reads data from target | `writes-to` | `db` / `table` / `async` |
| `writes-to` | This writes data to target | `reads-from` | `db` / `table` / `async` |

**Which side to declare.** Pick the natural direction and declare it
once. For an API, the consumer declares `calls` (or the provider
declares `serves`) — not both manually; the UI computes and shows the
inverse on the other component's page (§6.4). For containment, the
child declares `part-of: <parent>`. For data flow, the active party
declares `reads-from` / `writes-to` toward the passive store / queue.

### 6.2 LinkProtocol — 10 values

```ts
type LinkProtocol =
  "rest" | "grpc" | "async" | "db" | "table" |
  "file" | "human" | "info" | "link" | "data"
```

| `protocol` | Visual cue (drawio / diagrams) | Use case |
|---|---|---|
| `rest` | Solid blue arrow | HTTP REST API |
| `grpc` | Solid purple arrow | gRPC |
| `async` | Dashed red arrow | Async / event-driven (Kafka topic, queue) |
| `db` | DB many-end | Direct DB connection (engine level) |
| `table` | ER-many arrow, orange | Flow targets a specific table rather than the whole engine |
| `file` | Dashed grey arrow | File / batch handoff |
| `human` | Dashed orange arrow | Manual / user action |
| `info` | Solid thick blue | Informational edge (no automated flow) |
| `link` | Plain line | Generic linkage |
| `data` | Solid thick pink | Data-flow edge when `db` / `async` would mislead |

`protocol` is optional. Containment links (`part-of` / `contains`)
normally carry no protocol.

### 6.3 target

`target` is either a known component id (the catalog renders it as a
clickable link with the type icon) OR free text (external system,
partner, a future component not yet in the catalog).

### 6.4 Inverse labels (display-only, computed on detail page)

When component A declares a link targeting B, **B's detail page shows
the inverse** of the role (`INVERSE_LINK_ROLE_LABELS` in
`src/lib/constants.ts`). The original side stays the source of truth on
disk; this is presentation only.

| Declared on source | Shown on target |
|---|---|
| `calls` | `Called by` |
| `serves` | `Served by` |
| `part-of` | `Contains` |
| `contains` | `Part of` |
| `reads-from` | `Read by` |
| `writes-to` | `Written to by` |

### 6.5 Mirror rule (used by Consistency Check)

The Consistency Check audits every link whose target is a known
component and flags a missing reciprocal declaration. For a link with
role R on target B, B should declare the inverse role
(`LINK_ROLE_INVERSE`) pointing back at the source:

- `calls` ↔ `serves` — API edge declared from both sides.
- `part-of` ↔ `contains` — containment declared from both sides.
- `reads-from` ↔ `writes-to` — data-flow edge declared from both sides.

A mirror **matches** when target + role + `protocol` + `name` all
agree, so two distinct APIs (different protocols) or two distinct data
items (different `name`) on the same target stay as separate edges.
The one-click "Apply" fix adds the inverse link to the target.

> Author guidance: **do not pre-declare both sides defensively.**
> Declare on the natural side; the UI surfaces the reciprocal direction
> and the Consistency Check can add the on-disk mirror when you want it.

---

## 7. ComponentCapability

```ts
interface ComponentCapability {
  name: string                        // free-form business capability
  role: "owner" | "contributor" | "consumer" | "indirect"
  description?: string
}
```

| `role` | Meaning |
|---|---|
| `owner` | Implements / runs the capability |
| `contributor` | Assists (logs, metrics, side actions) |
| `consumer` | Uses the capability |
| `indirect` | Touches it incidentally (auto-migrated from legacy `business_capabilities`) |

A non-exhaustive starter list lives in
`constants.ts → BUSINESS_CAPABILITIES` (Customer Management, Order
Management, Billing & Invoicing, …) — used as autocomplete in the
form. Free text is accepted.

---

## 8. ComponentProcess

```ts
interface ComponentProcess {
  name: string                        // business process
  role: "owner" | "participant" | "listener" | "trigger"
  activity?: string                   // short label of what the component does in the process
  description?: string
}
```

| `role` | Meaning |
|---|---|
| `owner` | Runs the whole process end-to-end |
| `participant` | Performs activities in the process |
| `listener` | Observes events emitted by the process |
| `trigger` | Initiates the process |

---

## 9. ComponentRule

```ts
interface ComponentRule {
  name: string
  kind: "formula" | "rule" | "constraint"
  summary?: string                    // one-line, applies to every kind

  // kind = "formula" -----------------------------------------------
  formula?: string                    // single expression line, e.g. "total = base * (1 + rate)"

  // kind = "rule" --------------------------------------------------
  given?: string                      // Given / When / Then
  when?: string
  then?: string

  // kind = "constraint" --------------------------------------------
  enforced_in?: string[]              // component ids where this invariant is enforced

  description?: string                // free-form prose, any kind
}
```

| `kind` | Use case |
|---|---|
| `formula` | A calculation expressed as an expression |
| `rule` | A behaviour expressed as Given / When / Then |
| `constraint` | An invariant that must always hold |

---

## 10. ComponentNFR

```ts
interface ComponentNFR {
  availability?: string               // free-form (e.g. "99.9%", "Tier 1")
  rto?: string                        // recovery time objective
  rpo?: string                        // recovery point objective
  max_latency?: string                // e.g. "p99 < 200ms"
  throughput?: string                 // e.g. "1k rps sustained"
  data_classification?: "public" | "internal" | "confidential" | "restricted"
  scaling?: "horizontal" | "vertical" | "none"
}
```

### 10.1 ComponentDiagram

```ts
interface ComponentDiagram {
  color?: string                      // override fill colour on global diagram
  shape?: string                      // future use — current renderer ignores
}
```

Optional visual overrides for the global Architecture overview and
drawio export. When absent, the type-derived defaults from
`TYPE_COLORS` apply.

---

## 11. Backward compatibility (read-only, never write)

The read-time migration runs in `src/lib/github.ts`
(`migrateComponent` → `migrateToLinksV2`). New saves drop every legacy
field, so disk converges to canonical v2 over time. Migration is
idempotent: a component already at `schema_version: 2` gets a no-op pass.

### 11.1 Field-level renames

| Legacy field | Migrates to | Notes |
|---|---|---|
| `dependencies[]` | `relationships[]` (`depends-on`) then → `links[]` | Very old shape |
| `description.technical` | `description.description` | Joined with `business` when both differ |
| `description.business` | `description.description` | Joined with `technical` when both differ |
| `business_capabilities: string[]` | `capabilities: [{ name, role: "indirect" }]` | One entry per legacy string |
| `data.consumes` / `data.produces` | `data.inputs` / `data.outputs` | Pre-pass before the data → links migration |

### 11.2 v1 → v2 edge migration (into `links[]`)

| Legacy edge | → `links[]` entry |
|---|---|
| `interfaces[direction: provides]` | `role: serves`, `protocol = interface.type`, name/description carried |
| `interfaces[direction: consumes]` | `role: calls`, `protocol = interface.type`, name/description carried |
| `relationships[parent-of]` | `role: contains` |
| `relationships[child-of]` | `role: part-of` |
| `relationships[depends-on]` | `role: calls` (description "Depends on" when none set) |
| `relationships[communicates-with]` | `role: calls` (description "Communicates with (bidirectional)") |
| `relationships[reads-from]` | `role: reads-from` |
| `relationships[writes-to]` | `role: writes-to` |
| `relationships[fallback]` | `role: calls` (description "Fallback / backup") |
| `data.inputs[name: X, source: B, purpose: P]` | `role: reads-from`, `target: B`, `name: X`, `description: P` |
| `data.outputs[name: X, consumers: [B, C], purpose: P]` | one `writes-to` link per consumer (`target: B` and `target: C`), `name: X`, `description: P` |
| `data.owns` | **DROPPED** — "source of truth" is not an edge; express via tags / capabilities |
| `DataKind` (16-value ontology) | **DROPPED** — not preserved; only `name` + `purpose` carry over |
| `relationships[].connector` / `interfaces[].type` | `links[].protocol` |

Edges are de-duped on `(target, role, protocol, name)`, so a link that
a previous save already moved into `links[]` is not duplicated by a
still-present legacy entry. Inputs with no `source` and outputs with no
`consumers` are dropped (orphan edges).

---

## 12. Annotated example

```yaml
# components/order-service.yaml

schema_version: 2                  # stamped on save; you may omit it
id: order-service                  # required on disk; usually slug of name
name: Order Service                # the only mandatory field on create
type: microservice                 # see §3
status: production                 # draft | production | deprecated
owner: payments-team               # free-form
tags:                              # free-form list
  - backend
  - payments-domain

description:
  description: |                   # unified narrative
    Owns the order lifecycle from creation through fulfilment.
    Publishes domain events on every state transition.

links:                             # §6 — every edge to another component
  # API edges (calls / serves) — protocol set
  - target: web-frontend
    role: serves
    protocol: rest
    name: Orders API
    description: REST endpoint for placing and querying orders.
  - target: inventory-service
    role: calls
    protocol: rest
    name: Inventory lookup
    description: Reads available stock when accepting a new order.

  # Containment (part-of / contains) — protocol omitted
  - target: payments-context
    role: part-of
    description: Owned by the Payments bounded context.

  # Data flow (reads-from / writes-to) — name carries the data item
  - target: inventory-service
    role: reads-from
    protocol: db
    name: StockLevel
    description: Validate availability at order time.
  - target: analytics-pipeline
    role: writes-to
    protocol: async
    name: OrderCreated
    description: Triggers downstream fulfilment and analytics.
  - target: notification-service
    role: writes-to
    protocol: async
    name: OrderCreated
    description: Customer notification on new orders.

capabilities:                      # §7
  - name: Order Management
    role: owner
    description: Source of truth for orders.
  - name: Payment Processing
    role: consumer

processes:                         # §8
  - name: Order to Cash
    role: participant
    activity: Creates order, debits inventory, hands off to fulfilment.

rules:                             # §9
  - name: Order total formula
    kind: formula
    formula: total = sum(line_items.price * line_items.qty) + shipping
    summary: How an order's total amount is computed.
  - name: Cancel on payment failure
    kind: rule
    given: Order is in state PENDING_PAYMENT
    when: Payment attempt fails three times
    then: Transition order to CANCELLED and release inventory
  - name: No negative quantities
    kind: constraint
    summary: All line items must have quantity ≥ 1.
    enforced_in:
      - order-service
      - web-frontend

nfr:                               # §10
  availability: "99.95%"
  rto: 15 minutes
  rpo: 1 minute
  max_latency: p99 < 300ms
  throughput: 500 rps sustained
  data_classification: confidential
  scaling: horizontal

risks:
  - Single point of failure in the order state machine.
  - Inventory deduction is eventually consistent — overselling possible
    under high concurrency.
```

---

## 13. Backlinks & inverse semantics (computed, not stored)

The catalog computes derived views by scanning all components at
request time — **none of these are stored on disk**:

| Derived view | What it is | Endpoint |
|---|---|---|
| Inbound links | Every link from another component that targets this one, shown with the inverse role label (§6.4) | `/api/components/[id]/inbound-links` |
| Combined links | Outbound links + inverted inbound, deduped | computed in `/component/[id]/page.tsx` |

LLMs producing components should **NOT add inverse declarations
defensively** — declare on the natural side only (§6.1, §6.5). The UI
surfaces the reciprocal direction automatically; the Consistency Check
treats only the MISSING-mirror case as an issue, not the
doubly-declared case.

---

## 14. Quick reference for code generators

When asking an LLM to produce a new component, paste this checklist
together with the model document:

- [ ] `name` is set (the only hard requirement).
- [ ] `id` either omitted (will be slugified) or set to a kebab-case
      slug that does not collide with existing ids.
- [ ] `type` is one of the 20 values in §3 (default `component`).
- [ ] `status` is one of `draft` / `production` / `deprecated`
      (default `draft`).
- [ ] Every `links[].role` is one of the 6 in §6.1.
- [ ] Every `links[].protocol` (when set) is one of the 10 in §6.2.
- [ ] API edges use `calls` (consumer side) or `serves` (provider
      side) with a protocol — declared once, on the natural side.
- [ ] Containment uses `part-of` on the child (parent omitted; the UI
      shows "Contains").
- [ ] Data flow uses `reads-from` / `writes-to`; `name` identifies the
      data item, `protocol` is typically `db` / `table` / `async`.
- [ ] `nfr.data_classification` if set ∈ §10's enum.
- [ ] `nfr.scaling` if set ∈ §10's enum.
- [ ] `data_model` only on `type: table` (warning otherwise).
- [ ] No legacy fields (`interfaces`, `relationships`, `data`,
      `business_capabilities`, `description.technical`,
      `description.business`) — write the canonical v2 shape only.
- [ ] Do not pre-declare inverse links on the target; the UI computes
      those (§6.4, §13).

When asking an LLM to **migrate** existing YAML, point it at §11 —
that table is the full set of read-time migrations, including the
v1 `interfaces` / `relationships` / `data` → `links[]` collapse.

---

## 15. Export / import round-trip

The catalog round-trips through YAML in exactly the on-disk shape:

- **Export single** — `GET /api/components/<id>/export` (or the
  *Download YAML* button on the detail page) returns one component as
  its canonical v2 YAML document.
- **Export all** — `GET /api/admin/export-yaml` (or the *Export YAML*
  button in the catalog header) returns a **multi-document bundle**:
  every component as a separate YAML document, `---` separated, with a
  leading comment header. Parse with `yaml.loadAll`.
- **Import** — paste or upload either a single document or a bundle in
  the Import dialog (`POST /api/components/import`). The `onConflict`
  mode decides what happens when an incoming `id` already exists:
  - `update` (default) — overwrite the existing component wholesale.
  - `merge` — **partial import**: keep the existing component and
    override only the top-level fields the patch provides (e.g. a YAML
    with just `id` + `nfr` replaces the NFR block, everything else
    stays). The merge is shallow per top-level field, the merged result
    is validated in full, then saved. Requires an `id` of an existing
    component.
  - `create` — append `-2`, keep both.
  - `skip` — leave the existing component untouched.

Exported YAML is byte-identical to what is stored on disk (shared
`src/lib/component-yaml.ts` serializer), so the edit-in-place workflow
is: export → edit the YAML → import with `onConflict: update` (whole
component) or `onConflict: merge` (just the fields you changed).
