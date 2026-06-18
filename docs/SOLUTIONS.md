# arch-tool — Solutions

> **What this is.** A *Solution* lets an analyst compose a new offering
> out of **existing catalog components** — pick what to reuse, fill the
> gaps with new ones, describe how they interact, and generate a
> Detailed Solution Description (DSD). It is the "to-be" layer over the "as-is"
> component catalog.

## 1. Why a separate entity (not containment, not a component type)

Ownership/deployment in the catalog is a **tree** (`part-of` / `contains`:
boundary ⊃ context ⊃ microservice ⊃ module). A component has one parent.

A solution is a **cross-cutting, many-to-many view**: `Order Service`
can belong to *Checkout* and *Subscriptions* at the same time. Modelling
that via `part-of` would break the single-parent tree. So a solution is
its own entity that **references components by id** — the component
catalog stays clean, and one component serves any number of solutions.

## 2. Storage & schema

One YAML file per solution at `solutions/<id>.yaml`, same Git provider /
history / export path as components.

```yaml
schema_version: 1
id: customer-self-service
name: Customer Self-Service Portal
status: draft                # draft | proposed | approved | built | retired
owner: digital-team
description: { description: "…" }
goal: "Reduce inbound support volume by 30%"
delivers:
  capabilities: [Customer Management, Order Management]
  processes:    [Self-Service Account Update]
members:                      # references to catalog components (many-to-many)
  - { component: web-frontend,     disposition: reuse,  role: "Portal UI" }
  - { component: order-service,    disposition: extend, role: "Read/cancel orders" }
  - { component: self-service-bff, disposition: new,    role: "BFF" }
flows:                        # to-be interactions between members
  - { from: web-frontend, to: self-service-bff, role: calls, protocol: rest, status: proposed }
nfr:   { availability: "99.9%" }
risks: ["Depends on a cancel endpoint on order-service that does not exist yet."]
```

- `disposition` ∈ `reuse | extend | new | external` — how the member is used.
- `flow.status` ∈ `existing | proposed`. Existing links between members
  are derived from the components' own `links[]`; `proposed` is the to-be
  delta that lives on the solution until promoted.
- `flow.role` / `flow.protocol` reuse `LinkRole` / `LinkProtocol`.

Types in `src/lib/types.ts`; enums + colours in `src/lib/constants.ts`;
serialization in `src/lib/solution-yaml.ts`; store in `src/lib/solutions.ts`.

## 3. Lifecycle: propose → approve → create

Nothing is written until the analyst approves. The composer produces an
in-memory **Proposal**; only **Create** persists the solution (and any
approved new components).

## 4. Deterministic proposer (with a seam for LLM later)

`src/lib/solution-proposer.ts` turns an intent into a `Proposal`:

```ts
intent   = { name, delivers: { capabilities[], processes[] } }
Proposal = {
  members[] // { component, disposition, role, reason }
  gaps[]    // { kind: "capability" | "process", value, suggestedName, suggestedType }
  flows[]   // { from, to, role, protocol, status, reason }
}
```

- **Members**: match each target capability/process against components'
  `capabilities[]` / `processes[]`, ranked by role strength
  (owner > contributor/participant > consumer/listener). Each pick carries
  a human-readable `reason`.
- **Gaps**: target capabilities/processes nothing covers → suggest a new
  component (editable name; default type `service`).
- **Flows**: seed `existing` links between chosen members; the analyst
  adds `proposed` ones.

A future LLM proposer emits the **same `Proposal` shape**, so the review
step and Create are identical regardless of strategy — the door for
Generate stays open without UI changes.

## 5. Click-first composer (4-step wizard)

Minimal typing (only the name). Everything else is clicking.

1. **Intent** — name + pick `delivers` capabilities/processes as chips
   (from `BUSINESS_CAPABILITIES` + processes already used in the repo).
2. **Skeleton** — proposer runs; tick members in/out, flip `disposition`
   via a segmented control, accept gap → new component (pre-filled name).
3. **Flows** — accept/reject proposed flows; add via dropdowns of members.
4. **Review** — scoped diagram preview, then **Create solution**.

**Create** is atomic: approved gap components are created first as
`status: draft` (pre-filled with the capability/process that closes the
gap), then the solution is saved referencing all members. A per-item
report shows created / skipped / errors (same shape as the YAML import).

## 6. Generated output — Detailed Solution Description (DSD)

Reuses the existing **Generate** pipeline's **`detailed-solution`** doc
type (the same nicely-formatted generator used for components/diagrams).
Context fed to the model = the solution YAML + the YAML of every member
component (via the existing `componentToYaml` export), passed as the
diagram `componentsYaml` with the solution name as the title. No bespoke
prompt — we route through what already produces the formatted document.

### Information the DSD draws on and where it comes from

| Section | Source |
|---|---|
| Executive summary | `name` / `goal` / `description` |
| Business context & drivers | `delivers` |
| Scope (in) | `members[]` |
| Solution architecture (inventory) | `members` + component `type/status/owner` + `disposition/role` |
| Component interactions + diagram | `flows[]` + derived `links[]` + scoped mermaid |
| Capability / process mapping + gaps | `delivers` × members' `capabilities[]` / `processes[]` |
| Non-functional requirements | `solution.nfr` + members' `nfr` (rollup) |
| Dependencies | members' `links[]` pointing outside the member set |
| Risks | `solution.risks` + members' `risks[]` |
| Business rules | members' `rules[]` |
| Implementation roadmap | `disposition` breakdown + member `status` |

About ~90% of the document is a direct field or **derived** from data the
components already hold — which is what validated the use case.

## 7. Scoped diagram & promote

- `buildSolutionMermaid(members, components, flows)` in
  `src/lib/architecture-mermaid.ts` — only the members; `proposed` flows
  dashed, `existing` solid.
- **Promote** (`POST /api/solutions/[id]/promote-flows`) writes `proposed`
  flows into the members' real `links[]` (reuses the `addLink` apply from
  `src/lib/consistency.ts`) and flips them to `existing`. The to-be
  becomes the as-is in one click, after approval.

## 8. MVP scope

- **Phase 1** — entity + storage + CRUD API, Solutions list + read-only
  detail (Overview/Members/Flows/Delivers/NFR & Risks), scoped diagram,
  nav entry, this doc.
- **Phase 2** — deterministic proposer + 4-step wizard + atomic create
  (with gap auto-create).
- **Phase 3** — Generate DSD (reuses the `detailed-solution` doc type) +
  promote proposed flows.

## 9. Open (folded for MVP, structured later)

- *Out-of-scope*, *assumptions*, *success metrics*, *stakeholders* — for
  now folded into `description` / `goal` / `risks` or templated by the
  model; first-class fields can come later.
- Solution editing in the UI — MVP detail is read-only; edit via YAML
  re-import or a later inline editor.
