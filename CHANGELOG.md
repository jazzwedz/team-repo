# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project loosely follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.39.0] — 2026-06-25

### Added

- **The DSD output structure is now editable** — a new **DSD Output** page
  (next to Agents). It's the counterpart to the trainable agents: agents are
  *how* each section is written; this defines *what* the DSD contains. You
  can edit each chapter's **title** and **guidance**, **add / delete /
  reorder** chapters, **move** a chapter to a different writer, and edit the
  writers'/critics' focus. **Document History** (chapter 1) is always added
  automatically.
  - Persisted to `dsd-structure.yaml` in the data repo (like the agents),
    with the built-in structure as the default — until you save an edit,
    generation behaves exactly as before.
  - The five writer agents and four critics are fixed (they map to trainable
    personas); the chapter list and descriptive text are what's editable.
  - The generator (`solution-dsd.ts`) and the Generate-DSD modal now read the
    active structure; the deterministic Runtime-Flow and chunked Functional-
    Requirements injections are skipped if you remove those chapters.
  - New API: `GET/PUT /api/dsd-structure`, `POST /api/dsd-structure/reset`.

## [0.38.2] — 2026-06-25

### Changed

- **Solutions list shows fuller names.** On the solutions overview the card
  title font was reduced (`text-lg` → `text-base`) so longer names fit, and
  a `title` tooltip was added so the full name shows on hover when it is
  still truncated.

## [0.38.1] — 2026-06-24

### Fixed

- **AI calls that fail to reach the gateway now say why.** A transport-level
  failure (DNS, connection refused/reset, connect timeout, TLS) surfaced as
  the useless `fetch failed` (e.g. "AI compose failed: fetch failed"),
  because Node hides the real reason in `error.cause`. The LLM gateway call
  and the OAuth token call now unwrap the cause and name the host —
  `Could not reach the LLM gateway at <url> [ECONNREFUSED] — …` — so it's
  clear whether it's the network/VPN, the gateway URL, or DNS. No behaviour
  change otherwise; genuine HTTP errors (4xx/5xx) pass through as before.

## [0.38.0] — 2026-06-22

### Added

- **Rule source documents are stored on the component (provenance).** When
  you import rules from a document (PDF / Excel / Confluence page), the
  extracted text is now saved as a sidecar in the data repo under
  `rule-docs/<componentId>/<docId>.md` (a per-component analogue of the
  solution source-docs store). The import dialog lists these previously-used
  documents and lets you **re-extract** from one (handy after the extractor
  improves) or remove it. New API: `GET/POST /api/components/[id]/rule-docs`
  and `GET/DELETE …/rule-docs/[docId]`; the rules-import endpoint also
  accepts `source: { type: "stored", docId }`. Pasted code stays transient
  (not stored).
- **"Import rules" is now available while editing a component, not just on
  the read-only detail page.** The button sits in the Rules card header, so
  it appears in the full edit form's **Rules & Calculations** tab *and* in
  the focused single-section edit dialog. Importing while editing appends
  the chosen candidates to the in-progress form (you save the form to
  persist them), instead of writing immediately.

## [0.37.0] — 2026-06-22

### Changed

- **The component edit form is now split into tabs**, mirroring the
  component view page's tabs for consistency — **Overview** (basics,
  description, data-model link, risks), **Properties** (source mapping,
  links, capabilities, NFR) and **Rules & Calculations** — so a field lives
  under the same tab whether you are viewing or editing it. Tabs only appear
  on the full New/Edit form; the focused single-section dialog
  (BlockEditDialog) is unchanged. Tabs whose blocks are all hidden by UI
  config are dropped, same as the view.

## [0.36.1] — 2026-06-22

### Changed

- **Rules extraction guidance generalised and softened.** The v0.36.0
  granularity guidance was too table-centric and too rigid ("one rule per
  row"). It now applies to any source type (prose spec, table, code, mixed)
  and frames per-row extraction as a judgement call — common but not
  mandatory: extract per-row when rows carry genuinely distinct logic,
  group truly-identical rows, and never split or pad artificially. Still
  biased toward completeness (5 rules from dozens of distinct cases is too
  shallow). The xlsx framing was softened to match.

## [0.36.0] — 2026-06-22

### Changed

- **Rules import now extracts far more, at finer granularity.** A ~30-row
  table used to yield only ~5 rules. Three fixes:
  - **Decision-table awareness** — the extractor is now told that a header
    row + many data rows is a lookup/parameter/decision table where *each
    row encodes its own rule* (condition columns → result column), and to
    split if/else branches, switch cases, threshold bands and named
    parameters instead of merging them.
  - **Loop-until-dry extraction** — Pass 2 now runs up to 5 rounds: round 1
    extracts what it can, each later round is a completeness sweep fed the
    names already found ("what did you miss?"), stopping when a round adds
    nothing new (or the 250-candidate cap is hit). One call abstracts and
    stops; the sweeps force out the long tail. Per-round token budget raised
    to 8192. Candidates are de-duped on name + formula/given/when/then, so
    distinct decision-table rows that share a name are kept.
  - **xlsx framing fixed** — the spreadsheet extractor previously labelled
    table rows as "worked examples", which actively told the model to ignore
    them; it now frames each row as a candidate rule.
  - Still strictly grounded — only what the source states; no invented rules.

## [0.35.1] — 2026-06-22

### Fixed

- **Confluence publish failed with "Error parsing xhtml: Undeclared general
  entity".** Confluence storage XHTML only allows the five XML built-in
  entities (`&amp; &lt; &gt; &quot; &apos;`) plus numeric refs, but `marked`
  preserves anything shaped like an entity (`&word;`) — so AI prose where an
  "&" is followed by letters and a ";" reached Confluence as an undeclared
  entity and rejected the whole page. The renderer now escapes every "&"
  that doesn't begin a valid XML entity, as a final pass that leaves CDATA
  code blocks untouched. Together with the stray-`<` guard (v0.32.1), the
  narrative is now hardened against both classes of XHTML-parse rejection.

## [0.35.0] — 2026-06-22

### Added

- **"Use source code" toggle in the Generate DSD modal.** Source-code
  grounding reads the connected repository for every mapped member
  (`gatherSourceEvidence`) and runs up to a dozen serial ADO Code Search
  queries (`gatherCodeInteractions`) — serial network round-trips that are
  the main driver of DSD generation time. The static "Source code will be
  used" note is now a checkbox (on by default, applies to both modes).
  Turning it off skips the repo reads + Code Search entirely, so generation
  is noticeably faster and grounds only on the catalog plus any attached
  source requirements. The choice is passed through as
  `DsdOptions.useSourceCode` and gated in `runDsd`.

## [0.34.0] — 2026-06-22

### Changed

- **Better AI process drafts — steps attach to the component that carries
  them.** The process-drafter used to collapse a whole process onto one
  lifeline, rendering substantive steps as notes even when the solution's
  wiring clearly named the component each step belongs to. The drafter now:
  - receives **richer member context** (type, disposition + role in the
    solution, top capabilities) via a shared, reusable payload builder
    (`src/lib/process-draft-payload.ts`), used by both the composer and the
    solution editor;
  - treats the solution's **flows as the backbone** of the sequence (not
    just "context"), so a step that reads/produces/stores/receives is
    addressed to the linked member as a message, with a `return` reply where
    a result flows back;
  - uses a note (`to: null`) **only** for a genuinely internal action.
  - It still grounds every step in the description/document and never invents
    interactions just to make every member participate. No vendor-specific
    text is baked into the prompt — only catalog-derived runtime values.

## [0.33.0] — 2026-06-22

### Added

- **Rich review step in the solution composer.** The final "Review" step of
  the New Solution wizard was an empty one-line count. It now renders a
  deterministic (no-AI) summary of everything known about the solution:
  name / owner / goal / description, a count strip, the delivered
  capabilities, the members (with disposition + role), the flows, **the
  architecture diagram, and a sequence diagram per process**. Lifelines are
  labelled from both existing and about-to-be-created components, so the
  analyst sees the full picture before clicking Create.

## [0.32.1] — 2026-06-22

### Fixed

- **DSD publish to Confluence failed with "Error parsing xhtml: Unexpected
  character '>' expected '='".** `marked` passes raw inline HTML through
  verbatim, so prose the AI writes in a DSD — a generic type like
  `List<String>`, or a comparison like `if a < b and c > d` — reached
  Confluence as a malformed pseudo-tag and its strict XHTML parser rejected
  the whole page. The renderer now neutralizes any `<` that isn't a
  well-formed instance of a known HTML tag (escaping `<String>`, `<T>`,
  `<b and c>`, etc.) while leaving real markup intact. Also self-close void
  `<input>` (task-list checkboxes) to avoid a related XHTML error.

## [0.32.0] — 2026-06-17

### Added

- **Import rules from Excel (.xlsx) — dependency-free.** The per-component
  Rules & Calculations import now accepts `.xlsx` alongside PDF. A lot of
  calculation logic lives in spreadsheets, so this reads each sheet into a
  values table **plus the cell formulas** (the authoritative calculation
  logic; rows read as worked examples), then the existing rules-extractor AI
  turns that into structured rules — formulas, given/when/then, constraints.
  - **No new npm dependency** (the corporate registry can't serve a
    spreadsheet library): `.xlsx` is a ZIP of XML, so it's read with a small
    built-in-`zlib` ZIP reader (`src/lib/zip.ts`) + light XML parsing
    (`src/lib/extractors/xlsx.ts`). Both are **standalone and reusable** by
    other parts of the tool later (e.g. the Catalog Curator).
  - Legacy binary `.xls` is not supported — the upload rejects it with a
    "Save As .xlsx" hint. Dates may surface as Excel serial numbers.

## [0.31.2] — 2026-06-17

### Changed

- **Rule "Detailed description" field is taller and resizable.** On a
  component's Rules & Calculations editor, the detailed-description textarea
  now defaults to ~2× the height and can be dragged taller (vertical resize),
  so longer calculation notes are easier to write.

## [0.31.1] — 2026-06-17

### Added

- **Publish reports how many diagrams it attached.** The publish response now
  carries `imagesUploaded` / `imagesTotal` and the dialog shows "N/M
  diagram(s) attached" — so when diagrams don't appear in Confluence you can
  immediately tell whether they were rendered + uploaded (a Confluence-side
  rendering issue) or never sent (a client render issue).

## [0.31.0] — 2026-06-17

### Changed

- **Publish diagrams as SVG attachments, not PNG.** Rasterising the mermaid
  SVG to PNG via a `<canvas>` hit the browser's **tainted-canvas** security
  block (`toDataURL` → "Tainted canvases may not be exported") because
  mermaid SVGs carry content the canvas treats as cross-origin. Switched to
  uploading the **SVG itself** as the page attachment (`diagram-N.svg`,
  `image/svg+xml`) — no canvas, so no taint; the diagram is still a static,
  plugin-free image in Confluence (and vector-sharp). The publish route picks
  the content type from the filename; everything else (client render →
  attachment upload → `<ac:image>`, re-publish overwrite) is unchanged.

## [0.30.2] — 2026-06-17

### Fixed

- **"SVG image load failed" — the real cause: duplicate attributes.** mermaid's
  root `<svg>` already carries `width="100%"` + `style`; prepending our own
  `width`/`height` produced a **duplicate attribute**, making the SVG invalid
  XML so the `<img>` refused it (Blob URL or not). Now the opening `<svg>`
  tag is normalised — existing width/height/style stripped, clean explicit
  dimensions + `xmlns`/`xmlns:xlink` added — so the diagram rasterises to PNG.

## [0.30.1] — 2026-06-17

### Fixed

- **Diagram→PNG rendering failed with "SVG image load failed".** Loading the
  mermaid SVG into an `<img>` via a data URL was unreliable (encoding/parse
  pitfalls). Switched to a **Blob URL** (`URL.createObjectURL`, revoked
  after), and ensured the SVG carries explicit width/height + an `xmlns` —
  so the diagrams rasterise to PNG reliably for the Confluence publish.

## [0.30.0] — 2026-06-17

### Added

- **Diagrams now make it into the published Confluence page (plugin-free).**
  Previously mermaid blocks were stripped on publish (Confluence can't render
  the source, and there's no mermaid plugin), so the DSD lost its
  architecture and process diagrams. Now, on **Publish**, the browser
  renders each mermaid diagram to a **PNG** (reusing the viewer's mermaid;
  `htmlLabels` off so the SVG rasterises cleanly), the publish route uploads
  them as **page attachments**, and the storage references them as
  `<ac:image>` — so the diagrams show as static images on any Confluence
  Data Center, no plugin or HTML macro required.
  - **Re-publish** overwrites the same attachment filenames (new version),
    matching the existing update-in-place behaviour.
  - **Best-effort & resilient:** diagrams are numbered to match the document
    order; a diagram that fails to render is simply omitted (its block is
    dropped) and the text still publishes. No new dependencies.
  New `uploadAttachment` on both Confluence providers, `src/lib/mermaid-to-png.ts`,
  and a mermaid-image mode in `markdownToStorage`.

## [0.29.1] — 2026-06-17

### Changed

- **Simplified the Generate DSD modal.** Removed the **Depth** and **Audience**
  toggles — generation now always runs at **detailed** depth for a **mixed**
  audience (the values are still applied internally, just no longer a choice).
- **The modal now states when source code will be used.** When the source
  repository is connected, the Generate DSD modal shows a note that the repo
  is read (read-only) for any member mapped to it (`source.paths`) and used as
  grounding — confirming the source-code evidence path is active.

## [0.29.0] — 2026-06-17

### Fixed

- **All Functional Requirements now make it into the DSD (no more truncation).**
  The functional writer produced the traceability table + every FR in one
  LLM call capped at 2200 output tokens, so long lists were cut off (e.g.
  only the first ~17 of 40 FRs appeared in chapter 8, even though all were
  listed in the overview). The FR chapter is now generated in **bounded
  chunks** of the deterministic FR seeds (8 per call) and assembled, so
  every requirement is written regardless of count, then injected as a
  locked chapter. The traceability table (chapter 7) still lists them all
  from the same stable seed ids.

### Added

- **Each Functional Requirement now cites its source detail.** Beyond the
  BRD/rule reference, every FR carries a **Source** line that names the
  originating catalog rule/process and, where it derives from the attached
  source document, quotes or summarises the specific passage that motivates
  it — making it clear *how and why* each requirement exists.

## [0.28.6] — 2026-06-17

### Changed

- **Neutralised domain-flavoured examples.** The generic formula example used
  in form placeholders, docs and the rules-import prompt
  (`premium = baseRate * (1 + riskFactor)`) was changed to a domain-neutral
  `total = base * (1 + rate)`, so the codebase carries no hint of any
  particular business domain. Final step of the vendor-neutrality pass.

## [0.28.5] — 2026-06-17

### Removed

- **Purged company-specific content from the repo and its history.** A strict
  audit found two tracked seed scripts under `scripts/` (sample/demo data —
  one describing a specific organisation's domain in detail) that predated
  the `/scripts` git-ignore and so stayed in the repository. Removed both
  from the working tree and from **all git history**, and scrubbed a pilot
  analyst's name (changelog), a Confluence space key used in URL examples,
  and an acronym used as an example label in three source comments. Done via
  a full-history rewrite (`git-filter-repo`) + force-push. Together with the
  earlier hostname fix, the private-repo switch and the pre-commit guard, no
  company identifier remains in any tracked file or commit.

## [0.28.4] — 2026-06-17

### Added

- **Vendor-neutrality pre-commit hook.** `.githooks/pre-commit` rejects a
  commit whose added lines contain a blocked vendor-specific term, replacing
  the manual grep discipline that had let an old example URL slip through.
  Enable per clone with `git config core.hooksPath .githooks`. The hook's
  patterns are bracket-escaped so the hook file itself carries no flaggable
  literal.

## [0.28.3] — 2026-06-17

### Fixed

- **Removed a vendor-specific hostname from a code comment.** A Confluence
  Data Center example URL in `confluence/datacenter.ts` named a real
  corporate host; replaced with a neutral `wiki.example.com` placeholder.
  Repo-wide scan (all tracked files, CHANGELOG, commit messages) is clean.

## [0.28.2] — 2026-06-17

### Fixed

- **Mermaid diagrams failed silently.** On a render error `MermaidPreview`
  stayed stuck on "Rendering diagram…" forever, hiding the problem (e.g. a
  process sequence diagram that wouldn't appear in a DSD). It now shows a
  clear "Diagram could not be rendered" notice with the diagram source, so
  failures are visible instead of invisible.
- **Sequence diagrams broke on special characters in labels.** The sequence
  builder now neutralises `&` (→ "and") and angle brackets in participant /
  message labels (e.g. "Terms & Conditions"), which could make mermaid fail
  to parse the `sequenceDiagram` under `securityLevel: "strict"` — so the
  Runtime Process Flow diagram renders reliably.

## [0.28.1] — 2026-06-17

### Added

- **The Runtime Process Flow chapter now embeds the sequence diagram.** The
  deterministic runtime render now includes, per process, the same mermaid
  `sequenceDiagram` shown in the Processes view (via the existing
  `buildSolutionSequenceMermaid`), above the numbered steps. The DSD viewer
  and the Save-as-PDF export already render fenced `mermaid` blocks, so the
  generated DSD finally shows the process picture, not just the text steps.

## [0.28.0] — 2026-06-17

### Added

- **Code-observed interactions ground the solution DSD.** When the source
  repo is connected and members map to code (`source.paths`), DSD generation
  now adds a **code-observed interactions** facts block: using ADO Code
  Search over the members' mapped folders, it finds which members actually
  reference each other in the real code and feeds those edges to the writers,
  so **Solution Architecture / Dependencies / Runtime Process Flow** reflect
  what the code does — and the writer is told to flag where a code-observed
  interaction isn't in the modelled flows (or vice-versa). Solution-scoped
  and grounding-only: it reuses the already-mapped `source.paths` (no
  per-component re-scan) and writes nothing. Bounded (≤12 member queries,
  ≤30 edges) and best-effort — never blocks generation, and silently skips
  if Code Search is unavailable. No new dependencies.

## [0.27.1] — 2026-06-17

### Fixed

- **Runtime Process Flow chapter went missing from generated DSDs.** In the
  agent-team mode the overloaded "functional" writer (traceability table +
  all FRs + runtime) was dropping its last chapter, so chapter 9 rendered as
  _(not generated)_ — even though the solution's modelled process sequences
  were correctly in the grounding facts. The Runtime Process Flow is now
  **rendered deterministically from the solution's `processes`** (the same
  actor→target steps that power the sequence diagram) and injected as a
  locked chapter, so it always appears and accurately reflects what's
  modelled (an analyst-provided runtime chapter still wins). Bonus: the
  functional writer is lighter. (Quick mode unchanged — tell us if you hit
  it there.)

## [0.27.0] — 2026-06-17

### Changed

- **Source mapper now searches code content, not just file names.** Find
  source files previously oriented only by path/name match, so a file that
  implements a component without its name in the path was invisible. It now
  combines name matches with a **content search**: it derives the likely
  folder(s) from the top name matches, then queries the **ADO Code Search
  API** (server-side, scoped to those folders via the `Path` filter) for
  files whose *code* mentions the component, and merges both into the
  candidate set the agent judges. If Code Search is unavailable it falls
  back to a **bounded local grep** (reads up to 120 files, folder-scoped
  first) — so it works either way. The scan response/logs report which
  content source was used (`code-search` / `grep` / `none`). No new
  dependencies.

## [0.26.2] — 2026-06-17

### Fixed

- **Code Search query rejected with 400.** ADO Code Search requires a
  `Project` filter whenever a `Repository` filter is set; the query only sent
  `Repository`/`Branch`, so the API returned `InvalidQueryException`. Added the
  `Project` filter. (The 400 confirmed the API is reachable and the PAT is
  authorized — only the query shape was wrong.)

## [0.26.1] — 2026-06-17

### Added

- **Code Search (ADO) health check.** Settings → Health checks gains a **Code
  Search (ADO)** test alongside the others. It probes the Azure DevOps Code
  Search REST API using the existing read-only `SRC_ADO_*` connection,
  deriving the search host automatically (`almsearch.dev.azure.com` on ADO
  Services, the collection host on Server; optional `SRC_ADO_SEARCH_URL`
  override). This confirms the API is reachable and the PAT is authorized
  before we build content-based source mapping on top of it. New
  `POST /api/healthcheck/code-search`, `src/lib/code-search.ts` (also exposes
  a reusable `codeSearch()` for the upcoming scanner). No new dependencies.

## [0.26.0] — 2026-06-17

### Added

- **Source mapper — AI finds which files implement a component.** A business
  analyst can't be expected to know where in the codebase a component lives,
  so mapping `source.paths` by hand was the wrong ask. A new **Find source
  files** button (on the Rules tab, shown whenever the source repo is
  connected) runs the `source-mapper` agent: it indexes the repo tree
  (read-only `listTree`), shortlists candidate files by name/id/tag match,
  reads a few file heads, and proposes which files implement the component
  with a confidence and reason. Approved files are saved as `source.paths`
  (union with anything already mapped). Anti-hallucination: only paths that
  actually exist in the repo tree (and were shortlisted) can be proposed.
  New `POST /api/components/[id]/source-scan`, `src/lib/source-mapper.ts`,
  `SourceScanDialog`. No new dependencies.
- **Source mapping is a standalone step.** Identifying where a component is
  coded (Find source files → `source.paths`) is decoupled from checking the
  code: the **Check against code** rule audit simply consumes `source.paths`
  when present (its button shows once files are mapped). Map once, by AI;
  then any code-aware check uses it.

### Fixed

- Removed a vendor-flavoured filename from the Source code card placeholder.

## [0.25.0] — 2026-06-17

### Added

- **Check rules against code — fill the `implemented` facet from the source
  repo.** A component whose rules map to source files (`source.paths`) gains a
  **Check against code** button on the Rules tab. The new `code-rule-auditor`
  agent reads those files from the connected read-only source repo and, for
  each documented (requested) rule, derives a structured **implemented**
  version from the actual code, cites it (file path + line range + verbatim
  snippet + deep link), and judges the **reconciliation**: *consistent*,
  *divergent* (with a note on how), or *requested-only* (not found in code).
  Business rules present in the code but missing from the catalog are
  surfaced as *implemented-only*. Findings render in the same
  `ProvenancePanel` (requested vs implemented, side by side) for review;
  applying merges the implemented facet + reconciliation onto the rules
  (and appends implemented-only rules) through the normal sha-guarded
  component save.
  - **Grounded:** the model returns a verbatim snippet which is located in
    the actual file to compute the real line range and deep link — anything
    that can't be located is dropped, so a citation can't be invented. The
    evidence records the branch/ref and capture date for honest staleness.
  - Read-only against the source repo; nothing is written there, and catalog
    writes happen only on approval. New
    `POST /api/components/[id]/code-rule-audit`, `src/lib/code-rule-audit.ts`.
    No new dependencies. (Extends the v0.24.0 dual-provenance model; links &
    capabilities are the next increment.)

## [0.24.0] — 2026-06-17

### Added

- **Dual-provenance data model (foundation for code-aware enrichment).** Rules,
  capabilities and links can now carry two provenance facets plus a status:
  **`requested`** (what the spec/BRD asked for, with its source) and
  **`implemented`** (what the code actually does — a structured version
  *derived* from the code **plus** the code *evidence*: file path, line range,
  verbatim snippet, deep link, and the ref/date it was captured at), with a
  **`reconciliation`** status (`requested-only` / `implemented-only` /
  `consistent` / `divergent`). The item's own fields stay the canonical
  published statement; these are optional, back-compatible layers on top.
  Shared types `SpecSource` / `CodeEvidence` / `Reconciliation` in
  `types.ts`; validator (`component-schema.ts`) and the component form
  preserve them through a round-trip. The rule cards on the component detail
  page render a read-only **Requested vs Implemented** panel with a drift
  badge via a new reusable `ProvenancePanel`. Populating `implemented` from
  the source code is the next step; this lands the model + display.

## [0.23.4] — 2026-06-17

### Reverted

- **Reverted the v0.23.3 dependency bumps.** The corporate npm registry
  (Artifactory) does not mirror the patched versions, so `npm install` failed
  there with `E503` on `js-yaml@4.2.0` (and the `hono` / `dompurify` /
  `@babel/core` overrides would have hit the same wall). Restored `js-yaml` to
  `^4.1.1` and dropped the transitive overrides so installs work on the
  corporate network again. The advisories these addressed are GitHub-side
  only and cannot be cleared this way until the corp registry mirrors the
  fixed versions — see CONTRIBUTING for that path. Build green, lockfile back
  to the previously-installable state.

## [0.23.3] — 2026-06-17

### Security

- **Cleared all open dependency advisories (14 → 0).** Bumped the one direct
  dependency at fault — `js-yaml` `^4.1.1` → `^4.2.0` (quadratic-complexity
  DoS in merge-key handling) — and pinned three transitive packages to their
  patched versions via `overrides`: `hono` `^4.12.25` (CORS wildcard +
  serve-static path traversal; pulled only by the `shadcn` CLI, never run by
  the app), `dompurify` `^3.4.9` (several sanitiser-bypass XSS variants;
  pulled by `mermaid`), and `@babel/core` `^7.29.6` (build-time file read).
  No new dependencies; `npm audit` reports 0 vulnerabilities; build green.

## [0.23.2] — 2026-06-17

### Changed

- **Agents page organised into tabs.** The growing agent roster is now split
  by functional area instead of one long list: **DSD team** (section writers,
  critic lenses, lead editor, coach), **Catalog & consistency** (catalog
  enricher, relationship auditor, Catalog Curator), and **Compose & import**
  (solution composer, process drafter, rules locator/extractor, document
  writer). Each tab shows a one-line description and a count; the
  **Retrain DSD agents** coach button and its proposal card now appear only
  on the DSD tab where they apply. Pure UI reorganisation — agent editing,
  renaming, avatars and the coach loop are unchanged.

## [0.23.1] — 2026-06-17

### Changed

- **Consistency check now asks before it runs.** Opening the dialog no longer
  auto-runs anything. The two audits are presented as **co-equal choices** —
  an **AI relationship audit** (infers links that should exist but no one
  declared) and a **deterministic check** (exact missing-backlink and
  duplicate-link scan) — with **AI pre-selected**. The chosen check runs only
  when the analyst confirms with **Run check**; switching mode clears the
  previous results so each run reflects exactly one check. Dialog copy
  rewritten to describe the two as equals rather than "deterministic scan +
  optional AI pass".

## [0.23.0] — 2026-06-17

### Added

- **Catalog Curator — turn any PDF into grounded catalog proposals.** A new
  **Curate from doc** button on the catalog reads an uploaded PDF (transient
  — never stored), cross-references it against your existing components and
  solutions, and proposes **Add / Update / Conflict** changes to existing
  components (description, capabilities, business rules). It is the
  document-first, repo-wide generalisation of the per-solution catalog
  enricher.
  - **Grounded with verifiable citations.** The PDF is fed to the model with
    page markers (per-page text via `pdf-parse`), and every proposal carries
    a page number + verbatim quote. The quote is checked to actually appear
    on that page server-side — anything unverifiable is dropped, so a
    citation can't be invented.
  - **Add / Update / Conflict.** Beyond adding missing facts, the Curator
    flags where the document is more complete than the catalog (Update) or
    contradicts it (Conflict, shown old→new) — it never silently overwrites.
  - **Review & apply.** Proposals are grouped per component with confidence,
    rationale and the source quote; tick the good ones and apply — each
    component is saved through the normal sha-guarded component PUT (existing
    fields updated by name, new ones appended). Nothing is written without
    approval.
  - **Trainable.** Each proposal can be rated 👍/👎; an **Improve Curator
    from feedback** coach pass turns recurring feedback into "lessons" for
    the new `catalog-curator` agent, committed through the standard agent
    apply path.

  New `POST /api/catalog-curator` (+ `/feedback`, `/coach`),
  `src/lib/catalog-curator.ts`, `extractPdfPages` in the extractors. No new
  dependencies.

## [0.22.0] — 2026-06-17

### Added

- **AI relationship auditor in the consistency check.** The catalog
  consistency dialog gains a **Find missing relationships (AI)** button — an
  opt-in pass that surfaces links which *should* exist but neither component
  declares (the deterministic check only audits the symmetry of links that
  already exist). It is a hybrid, grounded, advisory flow:
  - A deterministic, no-LLM **candidate generator** produces a bounded, ranked
    set of component pairs with no link between them but cheap signals they
    should — a solution flow, a shared data component (one writes / one reads),
    a textual mention, shared solution membership, or an orphaned component.
  - The new trainable **`relationship-auditor`** agent then judges each
    candidate, returning a direction, role, optional protocol, **confidence**
    (0–1) and a **rationale** citing the evidence. Verdicts are validated
    against the offered pairs and the role/protocol enums (anti-hallucination)
    and anything below a confidence floor is dropped.
  - Results show as advisory rows (AI + confidence badge, rationale) you
    approve one-by-one or in bulk — **nothing is written automatically**. Only
    the primary edge is proposed; its mirror is left to the deterministic
    checker on the next scan, so no mirror logic is duplicated.

  New `POST /api/admin/consistency-check/ai`, `src/lib/relationship-audit.ts`.
  The apply endpoint now also accepts an inline AI fix (`{ applyTo, fix }`),
  and `applyFix`'s `addLink` is idempotent (no-op when the link already
  exists). No new dependencies.

### Changed

- **Repo housekeeping.** Git-ignored local-only paths (`/.claude` Claude Code
  config, `/scripts` one-off utilities) and removed stale DrawIO test-export
  artifacts (`arch-components.xml`, `export-test.xml`) plus an empty stray
  directory from the repo root. No application or runtime change — `src/` is
  untouched.

## [0.21.2] — 2026-06-16

### Changed

- **Rich DSD editing no longer needs an extra dependency.** Removed
  `@uiw/react-md-editor` (the corporate npm registry could not serve it,
  failing `npm install` with a 503). The **Rich** edit mode is now a split
  view — raw markdown on the left, a live rendered preview on the right —
  built from the `react-markdown` renderer already bundled in the app. Same
  Rich/Markdown toggle, same Save; nothing new to fetch on `npm install`.

### Changed

- **Simplified the "Improve data from DSD" review.** One **Apply** button
  (next to Close) commits all ticked proposals across every component in a
  single action; on success the dialog closes back to the Documentation tab.
  Removed the per-component Apply buttons and the auto re-propose — it's a
  clean one-shot. Components that fail to save are highlighted and kept open
  so you can retry; the rest still apply.

### Added

- **Rich editing mode for DSDs.** The DSD editor now has a **Rich / Markdown**
  toggle. **Rich** (the default) is a live markdown editor with side-by-side
  preview and a formatting toolbar (`@uiw/react-md-editor`, loaded client-only
  via dynamic import); **Markdown** is the plain raw textarea. Both save the
  same way and the Table of Contents stays re-derived on save.

### Added

- **Named, versioned DSDs in the library.** Each generated DSD now has a
  title shown in the Generated DSDs list — defaulting to
  `<solution name> v<N>` by generation count (v1, v2, …) — and the analyst can
  **rename** it inline to anything custom. The title also shows in the
  document viewer header. Rename uses the artifact PUT (`{ title }`); it does
  not flag the artifact as content-edited.

### Added

- **Generated DSDs are editable.** The document viewer gains an **Edit**
  button; in edit mode the raw markdown is shown for hand-editing and a plain
  **Save** (next to Save as PDF) persists it back to the artifact. Everything
  is editable except the **Table of Contents**, which is re-derived from the
  headings on save (so it can't drift). An edited artifact is flagged
  **edited** (badge in the DSD library) with an `editedAt` timestamp. New
  `PUT /api/solutions/[id]/dsd/artifacts/[artifactId]`.

### Changed

- **Made the catalog-enrich flow sane and conservative.** It was over-eager:
  because capabilities/rules are proposed additively, each run kept inventing
  more "new" items, so it never converged. The agent now defaults to
  proposing **nothing**, only suggests a description change when the current
  one is missing/incomplete (never a stylistic rewrite), and proposes new
  capabilities/rules **only when a stored BRD explicitly evidences them**
  (none at all when no BRD is stored). Hard backstop: at most 3 capability and
  3 rule additions per component per run. A re-run on an already-good catalog
  now returns nothing.
- **Moved & renamed the button** — now **"Improve data from DSD"** next to
  **Generate DSD** on the Documentation tab (was "Improve components" in the
  DSD library header).

### Added

- **"Improve components" — enrich the catalog from a solution's sources.** A
  new standalone flow (button on the solution's Documentation tab) that reads
  the member components' current catalog entries plus the stored source
  document (BRD) and proposes **business-focused** improvements via a new
  trainable `catalog-enricher` agent: a clearer/completed **description**, new
  **capabilities** (with role), and new **business rules**. It is strictly
  propose → review → approve → commit — nothing is written automatically. The
  review dialog shows each proposal (description diff with editable text,
  per-item checkboxes for capabilities/rules) and applies approved changes
  through the normal component save (sha/lock-guarded; existing entries are
  never overwritten — capabilities/rules are added, the description is shown
  as a diff you confirm). New `POST /api/solutions/[id]/enrich`.

### Fixed

- **Confluence publish failing with "Error parsing xhtml: Unexpected close
  tag `</p>`; expected `</br>`" (HTTP 400).** Confluence storage format is
  strict XHTML, but the markdown→storage conversion emitted HTML-style void
  tags (`<br>`, `<hr>`, `<img …>`) that the parser rejects. They are now
  self-closed (`<br/>` etc.) before code blocks become CDATA, so literal
  void tags inside code samples are left untouched. Fixes both DSD and
  component publishing.

### Added

- **Stable requirement ids, implementation status, AS-IS/TO-BE and worked
  examples in the DSD** — the final polish of the functional-spec rebuild.
  - The grounded facts now carry deterministic **requirement seeds**: each
    business rule, process and NFR target is assigned a stable `FR-NN` /
    `NFR-NN` id from a fixed catalog ordering (members by id, rules by name),
    so regenerations of the same catalog produce the **same ids** — keeping
    the Traceability Matrix and per-section feedback anchored. Requirements
    derived from the BRD/code take the next free numbers.
  - Each FR carries a **status** (Implemented / To be implemented) derived
    from the member's disposition and the component status; members marked
    *extend* are flagged to describe **AS-IS vs TO-BE** explicitly.
  - Formula/calculation requirements are asked to include a short
    **input → output worked example** table.
  - Applies to both agent-team and quick modes.

### Notes

- This completes the DSD functional-specification rebuild (Stages 1–4 +
  BRD storage): structure, BRD grounding, ADO source-code grounding,
  data-model column specs, and now stable ids / status / examples.

### Changed

- **Source requirements documents (BRD) are now stored on the solution and
  reused — upload once.** Previously a BRD had to be attached separately at
  solution creation and again at DSD generation. Now documents are persisted
  as sidecar files (`source-docs/<solutionId>/…`, kept out of the solution
  YAML so listing stays light):
  - The **solution composer** saves the uploaded source document onto the new
    solution automatically.
  - The **Generate DSD** modal manages the solution's stored documents
    (add via upload / paste / Confluence URL, or remove) instead of a
    one-off attachment.
  - **DSD generation auto-uses** the stored documents as grounding every
    time — no re-upload.
  - New API: `GET/POST /api/solutions/[id]/source-docs` and
    `GET/DELETE /api/solutions/[id]/source-docs/[docId]`.

### Added

- **Data-model column specs in DSD generation.** For table-type members that
  link a registry entity (`data_model.entity`), the entity's attributes (and
  relationships) are now pulled from the data-model registry at generation
  time and fed to the agent team as authoritative **column specifications**,
  so the Data Structures chapter renders real `Field | Type | Nullable`
  tables instead of placeholders. Bounded (≤12 entities, ≤80 attributes each),
  best-effort, and gated on the registry being configured — never blocks
  generation. (Stage 3 of the functional-spec rebuild; FR↔BRD traceability is
  already covered by the attached-BRD grounding from 0.13.0.)

### Added

- **Source-code grounding for DSD generation (Azure DevOps, read-only).**
  Components gain an optional **Source code** card (`source.paths`) mapping
  the component to the files that implement it in the connected source repo.
  At DSD generation, those files are read (read-only, bounded by file/total/
  count caps) and fed to the agent team as **authoritative source-code
  evidence**, so the Functional Requirements (behaviour, inputs, steps),
  Data Structures and embedded logic reflect the real code — not just the
  catalog. The catalog still defines the component inventory.
  - The Source code card self-hides when the connection isn't configured
    (new `GET /api/source-code/status`); `source` is now a first-class
    component field (schema + import validation).
  - Completes Stage 2 of the functional-spec rebuild (2a = BRD grounding,
    2b = code grounding). Requires `SRC_ADO_*` env + a read-only PAT.

### Added

- **Attach a source requirements document (BRD/spec) when generating a DSD.**
  The Generate DSD setup gained a "Source requirements (BRD / spec)" section —
  upload a PDF/text file, paste text, or pull a Confluence page (reuses the
  existing extractor). The extracted text is fed to the agent team as
  additional grounding so the **Document Purpose** references, the
  **Functional Requirements** and the **Traceability Matrix** are derived from
  the real requirement document, not just the catalog. The catalog still
  defines the component inventory — the BRD informs behaviour and
  requirements only. The source document's name is recorded on the artifact
  for provenance. (Stage 2a of the functional-spec rebuild; ADO source-code
  grounding is Stage 2b.)

### Changed

- **DSD structure rebuilt into a component functional-specification**, modelled
  on real-world DSDs. The chapter set is now: Document History → Document
  Purpose (intended usage; what it does & does not do; reference docs & data
  model) → Solution Context (upstream / downstream / responsibility
  boundaries) → Scope → Solution Architecture → Capability Mapping →
  Requirements & Traceability Matrix → **Functional Requirements (FR-NN)** →
  Runtime Process Flow → **Data Structures** → Non-Functional Requirements
  (NFR-NN) → Business Rules → Risks & Assumptions → Implementation Roadmap →
  Appendix & References. Document History gained Author(s)/Contributor(s)
  columns. Applies to both quick and agent-team modes.
- **Agent-team writers re-themed** to match: `dsd-writer-purpose`,
  `dsd-writer-architecture`, `dsd-writer-functional`, `dsd-writer-data-nfr`,
  `dsd-writer-rules-roadmap` (the team UI, registry and per-section feedback
  follow automatically).

### Notes

- This is the first stage. Functional Requirements, Data Structures and the
  Traceability Matrix are grounded in the catalog today (rules, processes,
  flows, capabilities, data-model links) and deepen in later stages once the
  source-code repo (ADO) and the source BRD are fed in as grounding.

### Fixed

- **React hydration error on the catalog page** ("a tree hydrated but some
  attributes … didn't match"). `useStoredState` read `localStorage` in the
  `useState` initialiser, so the client's first render used the persisted
  value while the server had rendered the default — and when that value
  drove a `className` (e.g. the grid/compact view buttons' variant) React 18
  flagged the mismatch and refused to patch it. The hook now renders
  `initial` on the server **and** the client's first render, then loads the
  stored value after mount (single re-render). Hydration matches; the only
  cost is one frame of defaults for users with non-default saved
  preferences. Fixes all `useStoredState` call sites (catalog filters/view/
  grouping, diagram dialog).

## [0.11.1] — 2026-06-16

### Changed

- Trimmed the published-DSD info panel to a single line — "Prepared by an
  analyst in Team Repository with AI assistance." — dropping the extra
  sentence about manual review / re-publishing. The AI agents + versions
  credit line stays.

## [0.11.0] — 2026-06-16

### Added

- **Source-code repository connection (read-only, Azure DevOps) + Test
  connection.** Groundwork for letting the consistency check read actual
  source code as evidence. A separate connection from the catalog data
  repo, configured via `SRC_ADO_BASE_URL` / `SRC_ADO_PROJECT` /
  `SRC_ADO_REPO` / `SRC_ADO_BRANCH` / `SRC_ADO_PAT` (read-only PAT, scope
  Code:Read) and verified under **Settings → Health checks → "Source code
  (ADO)"** with the usual four-step probe. Reuses the existing ADO provider
  (read methods only); MVP is one repo. The check logic itself and the
  per-component code mapping are a separate, later stage.

### Changed

- **Reworked the info panel on published DSD Confluence pages.** It now
  reads as analyst-authored work via **Team Repository** (a person in the
  loop with AI assistance), not an autonomous bot output, and re-publishing
  is framed as an analyst choice. Removed the link back to the tool (it runs
  locally inside the corp network, so a public/test URL was misleading). A
  small, de-emphasised line credits the AI agents and versions that
  assisted (overview info).

## [0.10.0] — 2026-06-16

### Added

- **Publish a DSD to Confluence (one-way).** Each generated DSD in the
  Documentation tab now has a **Publish / Re-publish** button. You pick the
  Confluence parent page (the "sub-directory") from a dropdown of the
  space's pages; the DSD is rendered to Confluence storage format and
  created/updated under that parent. The chosen parent and the resulting
  page URL are **remembered per DSD** — re-publishing updates the same page
  and pre-selects the parent — and a clickable **In Confluence** link is
  shown on the artifact. Works on both Cloud and Data Center editions.
  - New `GET /api/confluence/pages` (space page list for the picker) and
    `POST /api/solutions/[id]/dsd/artifacts/[artifactId]/publish`.

### Fixed

- **Published page link no longer inserts a spurious `/wiki`.** The link is
  now built from the canonical base Confluence reports in `_links.base`
  (plus the page's `webui`) instead of the configured API base URL. On Data
  Center the API base often carries the `/wiki` REST context path, which
  was bleeding into the browser link and producing a "Page Not Found" URL
  like `…/wiki/spaces/TEAM/pages/1219298970`; the link is now the canonical
  `…/spaces/TEAM/pages/1219298970/…`. Data Center also strips a trailing
  `/wiki` from the fallback base for safety.

## [0.9.2] — 2026-06-16

### Fixed

- **"Failed to execute 'json' on 'Response': Unexpected end of JSON input"
  when opening a component for editing.** The edit page acquired its
  advisory edit lock by calling `res.json()` on the lock response without
  guarding against an empty or non-JSON body. When the lock endpoint
  returned no body (e.g. a 500 or a proxy/auth interception), the parse
  threw and surfaced as a cryptic red banner that blocked editing. The lock
  responses are now parsed defensively across acquire, refresh and retry;
  an unreadable response degrades gracefully (the analyst can still edit and
  the save-time hash check remains the real safety net).

## [0.9.1] — 2026-06-14

### Changed

- **AI progress modals redesigned to match the rest of the tool.** Dropped
  the dark/neon "command-center" look in favour of the clean light
  black-and-white style used everywhere else (white background, muted
  borders, primary accents). The animation stays — nodes pulse, data flows
  between stages, the rail moves — just without the colours. Applies to the
  DSD agent-team modal and the single-agent run modal.

## [0.9.0] — 2026-06-14

### Added

- **"Generate DSD" setup modal.** Clicking Generate now opens a setup dialog
  instead of generating immediately, so you configure each run:
  - **Mode** — Quick / Agent team (moved here from the tab).
  - **Reuse locked content from the last DSD** — default **ON**; pulls your
    previously fixed chapters so you don't re-paste them.
  - **Bring your own content** — per-chapter lock editor (moved here).
  - **Depth** — Concise / Standard / Detailed (adjusts guidance + length).
  - **Audience** — Technical / Management / Mixed (adjusts tone).
  - **Advanced** — pick which **chapters to include**, and the **language**
    (English / Slovak).
  Depth, audience and language are threaded into the writers (and quick
  mode); chapter selection restricts which chapters the team writes and the
  TOC. The Documentation tab is now just a clean "Generate DSD" button.

## [0.8.3] — 2026-06-14

### Changed

- **Locked chapters now inform the whole document.** When generating a DSD
  with locked (analyst-provided) chapters, *every* writer — not just the one
  in the same group — receives all locked chapters as context, so the AI-
  written parts stay consistent with what you fixed (terminology, decisions,
  numbers) across the entire document. (Capped to keep prompts bounded.)

## [0.8.2] — 2026-06-14

### Added

- **Each agent card now shows where & how it's used.** A short context line
  on every agent (e.g. "DSD generation → writes Solution Architecture…",
  "Solution composer → 'Pre-fill with AI'…") so you know exactly what you're
  tuning when you edit its prompt.

## [0.8.1] — 2026-06-14

### Added

- **Agent avatars on the Agents page.** Each agent now has a face — a human
  silhouette on a deterministic per-agent colour, with a small role badge
  (writer / critic / lead / coach / assistant) — so the roster reads as a
  team of distinct colleagues. Click an avatar to **override it with your
  own emoji** (or reset to default). No new dependency (built from lucide +
  a colour hash).

## [0.8.0] — 2026-06-14

### Added

- **Bring your own content — per-chapter locked sections (DSD team mode).**
  Before generating, open "Bring your own content" and paste any chapter you
  already have. A filled chapter is **🔒 locked**: used **word-for-word**,
  the writers skip it (faster/cheaper), critics don't flag it, and the lead
  pass is skipped so it's never reworded. Empty chapters are written by the
  AI as usual.
  - The pipeline drafts only the **unlocked** chapters of each group and
    splices the locked text in by chapter order; revise touches only
    unlocked chapters.
  - **Reuse locked from latest** pulls your locked chapters out of the most
    recent DSD so you don't re-paste them on a regenerate.
  - The progress modal shows a **🔒 N chapters kept as-is** indicator.
  - Vendor-safe: provided text is a generation-time input (it lands only in
    the produced DSD artifact, like before) — not stored separately on the
    solution.

### Changed

- **Golden exemplar is now explained in the UI.** The feedback panel and the
  "bring your own content" panel both spell out the difference: 🔒 **lock**
  ("use exactly this") vs. **correction** ("learn my style") — a saved
  correction on a section becomes a golden example that trains that writer.

## [0.7.1] — 2026-06-14

### Added

- **Every AI moment is a configurable agent.** Beyond the DSD team, the
  single-agent AI features now run through editable agent prompts you can
  tune on the Agents page (grouped under "AI assistants"):
  - **Solution composer** (`ai-compose`)
  - **Rules locator** + **Rules extractor** (the two rules-import passes)
  - **Documentation writer** (component/diagram doc generation)
  - **Process drafter** (process-sequence AI draft)
  Each route now uses `agentInstruction(getAgent(id))` as its persona; the
  task scaffolding (JSON schema, grounded facts, audience/doctype) stays in
  the route. (Goal extrapolation, blast memo and Confluence pull stay plain
  for now.)
- **Premium "agent at work" modal for every AI moment.** A reusable
  `AgentRunModal` brings the command-center aesthetic (neon nodes, flowing
  data streams, console readout) to compose, rules import (two nodes),
  doc generation and process draft — positioned high on screen.

### Changed

- **Redesigned the DSD progress modal into an "agent command center"** —
  the full pipeline live (Facts → 4 writers → 4 critics → Lead → Library)
  as a dark, futuristic scene. Both modals now sit higher on screen.

## [0.7.0] — 2026-06-14

### Added

- **Multi-agent DSD generation (a real agent team).** Team mode is now a
  section-specialised pipeline instead of one writer:
  - **Section writers** — four specialised, trainable writers (Business,
    Architecture, NFR & Risk, Rules & Roadmap), each drafting its chapters
    in parallel with the full token budget for depth.
  - **Critic panel** — four lenses (grounding, completeness, clarity,
    consistency) review the draft in parallel; their issues are routed back
    to the owning writer for a targeted revise.
  - **Lead editor** — a guarded consolidation pass smooths flow and
    consistency across sections (discarded if it would drop content).
  - Quick mode is unchanged (single writer → critic → revise).
- **Targeted agent training.** Analyst feedback can now be tagged with the
  **section** it is about, so the coach trains the exact writer that owns it
  (whole-document feedback still trains the lead / critics). Feedback bar
  gained a section selector.
- **Golden exemplars.** An analyst's corrected section becomes a few-shot
  exemplar for that writer on the next run — the strongest training signal.
- **Expanded, grouped Agents page.** The roster (4 writers · 4 critics ·
  lead · coach) is listed by role; the coach proposal now applies per-agent
  deltas you approve individually. Per-agent prompt + lessons editing
  (from v0.6) works across the whole team.

### Changed

- **Agent team is the default DSD mode** (Quick stays an opt-in) — both the
  composer toggle and the API default.

### Fixed

- **AI/composer paths no longer produce retired process fields.** The
  composer stopped seeding `component.processes` on gap components, and the
  AI-compose return type / proposal summary dropped `delivers.processes` —
  so no AI import or generation path writes the retired process tags any
  more (they remain read-only for Confluence/export back-compat).

## [0.6.1] — 2026-06-14

### Changed

- **One unified "process" concept.** Previously "process" meant three
  overlapping things — component tags, a solution's `delivers.processes`
  chips, and the new sequences — which was confusing. Now a process **is**
  the editable sequence on a solution; everything else is derived:
  - `ProcessActor` gained an optional **role** (owner / participant /
    trigger / listener), edited in the sequence's new **Participants** row.
    The AI drafts roles too.
  - **`/processes`** is now a read-only index **derived from the
    sequences**: each process name → participants (with roles) → the
    solutions that model it.
  - Removed the old surfaces: the component **Processes** block (editor +
    detail + its maturity dimension) and the solution **Delivers →
    processes** chips, plus the per-sequence "delivers" link. Capabilities
    remain the proposer's delivers axis (process-based proposal is now
    emergent from sequences).
  - **Back-compat:** the `component.processes` / `delivers.processes`
    fields stay in the model and are still read by Confluence sync and
    catalog export, so existing YAML keeps working — they're just no longer
    edited or shown as a separate concept.

### Fixed

- **Process step with an unset "from" silently dropped from the diagram.**
  A new step defaulted its `from` to `""` when no actors existed yet; a
  native `<select>` shows the first option for an unmatched value, so the
  dropdown looked like it pointed at the first member while the step was
  actually unset — and the sequence builder skipped it. New steps now
  default to a real member (added as an actor), and the "from" select shows
  an explicit "— choose actor —" placeholder instead of masquerading.

### Added

- **AI pre-fill now seeds a starter process sequence.** "Pre-fill with AI"
  (`ai-compose`) returns a main process — actors (members + externals) and
  ordered steps — alongside the skeleton. Applied only when the solution has
  no processes yet, so it never clobbers hand-authored ones; the analyst
  refines it in the Processes step.

### Changed

- **Solution editor split into tabs.** The editor was one long form; it now
  uses tabs — Details · Delivers · Members · Flows · Processes — matching the
  detail page, with Save always available in the header. Much easier to
  navigate than the single scroll.

- **Processes page is now a hub.** `/processes` cross-links the process
  concept: for each business process it shows supporting components (as
  before) plus the solutions that **deliver** it and the solutions that
  **model it as a sequence** (linked by `deliversProcess`/name, with step
  counts and a link to drill in). A process modelled or delivered but
  declared by no component is flagged ("not in component catalog") as a
  naming-consistency hint.

## [0.6.0] — 2026-06-14

### Added

- **Process sequences on solutions.** A solution can now document one or
  more ordered process sequences — how it actually runs a process, step by
  step — modelled as actor→target messages and rendered as a mermaid
  **sequence diagram** in the zoom/pan/expand preview. Structure-first:
  the steps are real data (`Solution.processes`), not a drawing.
  - **Actors** are members or **external** participants (user/role/system
    not in the catalog), auto-managed from the step dropdowns.
  - **Step kinds**: sync, async, return, and note (internal action with no
    target renders as a `Note over`). Manual ↑/↓ ordering (order is the
    meaning).
  - Editable in both the **composer** (new "Processes" wizard step) and the
    **solution editor**; rendered read-only on a new **Processes** tab of
    the solution detail page.
  - Each process can optionally **link to a delivered process** by name, or
    stand alone.
  - **AI draft** (`POST /api/solutions/process-draft`) proposes a sequence
    from the solution's intent, members, flows and any uploaded source
    document — grounded, the analyst edits.
  - Feeds **DSD generation**: process sequences are added to the grounded
    facts, so the generated document gets an accurate process chapter.

- **Readable live preview at scale — zoom, pan, expand.** The solution
  composer's live diagram was fit-to-width, so labels shrank as components
  were added. It now renders at natural size inside a pan/zoom viewport
  (drag to pan, wheel or +/− to zoom, Fit, Reset) so text stays crisp, plus
  an **Expand** button that opens the diagram in a near-fullscreen modal.
  Gated behind a `zoomable`/`expandable` prop on `MermaidPreview`, so every
  other diagram keeps its previous fit-to-width behaviour.

- **Edit agent prompts directly.** The Agents page now lets you edit an
  agent's raw **system prompt and lessons** in place (Edit prompt → Save &
  commit), independent of the coach's propose → approve loop. Saves through
  the existing `/api/agents/apply`, committing a new version. Applies to
  the writer, critic and coach.

- **Live solution diagram in every composer step.** The `/solutions/new`
  wizard previously only rendered the scoped mermaid diagram on the final
  Review step, so analysts adjusting the auto-proposed flow had to advance
  to Review and back to see the effect. The diagram now lives in a
  **sticky side panel** beside the wizard (two-column on wide screens,
  stacks below on narrow), visible and updating in every step (pilot
  feedback, the pilot analyst).

- **Flow ordering in the solution composer.** The Step 3 "Proposed flows"
  list gained the same controls as the solution editor — one-click
  **Sort A–Z** and per-row **↑/↓** reorder — so duplicates are easy to
  spot and the sequence carries into the saved flows and the diagram.

- **Name-seeded AI pre-fill that fills the empty fields.** "Pre-fill with
  AI" now needs only a **name** (was gated on goal + description). It
  fills the **goal and description** when they are empty — never
  overwriting what the analyst typed — alongside delivers/members/flows,
  and now **stays on the Intent step** so the result can be reviewed
  before continuing (the proposed skeleton is carried through instead of
  being re-derived).

- **Source documentation as AI context.** The upload control moved to the
  Goal field and is renamed **"Upload source documentation"**. The
  extracted text is held as a separate, removable context (shown with a
  "view text" toggle), extrapolates an empty goal
  (`POST /api/solutions/extrapolate-goal`), and is passed to AI pre-fill
  as grounding. The raw text is **not** poured into the description — that
  field stays the analyst's to write (AI pre-fill can still draft it). It
  survives the draft but is **never written to the saved solution** — raw
  requirement text can carry terms that must not enter the repo.

### Security

- **All 4 dependabot moderate advisories cleared (`npm audit` → 0).**
  `hono` and `qs` (transitive via the `shadcn` CLI) bumped to patched
  patch releases; the nested `postcss` (`<8.5.10`, XSS in CSS stringify)
  forced to `^8.5.10` via an npm `overrides: { postcss: "$postcss" }`
  entry plus a direct-dep bump — avoiding the `npm audit fix --force`
  path that would have downgraded Next to 9.3.3. Next picked up the
  15.5.18 → 15.5.19 patch in the same install. Build + typecheck green.

### Fixed

- **Mermaid diagrams crashed on labels with brackets (e.g. “Part of
  (group)”).** Edge labels (`-->|…|`) are not quoted, so mermaid lexed the
  `(){}[]` characters as structural tokens and threw a parse error,
  blanking the whole diagram. Label escaping now maps those characters to
  numeric HTML entity codes in all three builders (component, architecture,
  blast-radius); mermaid renders them back to the literal glyph.

- **AI calls failed on broken characters (“invalid high surrogate”).**
  Catalog/component data containing an unpaired UTF-16 surrogate (half an
  emoji, a truncated paste) made the LLM request body invalid JSON, so
  AI assist / DSD / coach returned a 400. The prompt is now normalised to
  well-formed Unicode (lone surrogates → U+FFFD) centrally in the LLM
  wrapper, protecting every AI feature. Valid emoji are preserved.

- **Coach suggestions no longer repeat / accumulate.** The coach re-read
  all feedback every round, so already-processed or rejected feedback
  kept coming back and piling onto new feedback. Replaced the fragile
  per-feedback bookkeeping with a simple **training watermark**
  (`agents/_coach-state.yaml`): each round considers only feedback newer
  than the last round, then advances the watermark past everything it
  saw. So a round's feedback is used exactly once — a declined suggestion
  can't reappear, and the next round sees only genuinely new feedback.
  Immune to older feedback that predated the id field. The Agents action
  is **Retrain agents** (Approve / Reject per suggestion); the progress
  modal sits higher on screen.

- **Solution composer: “Create” greyed out with no reason + risk of
  losing work.** The AI-assist path could reach the Review step without a
  name (the “Pre-fill with AI” button only needs goal + description, and
  Apply jumps past the name check), leaving Create disabled and the
  analyst stuck. Now the Review step shows a clear “needs a name” notice
  with an inline name field to fix it in place. Plus:
  - The whole wizard is autosaved to `localStorage` and restored on
    reopen — a failed save, reload or crash no longer loses the work
    (cleared on successful create; a “Start over” button discards it).
  - `create` guards an empty slug and an unconfirmed save, keeping the
    work in the wizard with a readable message.
  - The create API now returns a clear 409 (“a solution with this name
    already exists…”) instead of a raw git error.

- **Rules-import crashed the whole endpoint (`Object.defineProperty called
  on non-object`).** `pdf-parse` (v2 → `pdfjs-dist`) breaks when webpack
  bundles it on the server, which threw at module load — so *every*
  rules-import request (PDF, Confluence or code) 500'd. Fixed by marking
  `pdf-parse` / `pdfjs-dist` as `serverExternalPackages` in
  `next.config.mjs` (runtime require instead of bundling) and lazily
  importing the PDF stack inside `extractPdf` so the Confluence/code
  paths never load it.

- **Rules-import (AI rule analysis) crashed with “Unexpected token '<'”.**
  The import-rules-from-documents dialog called `res.json()` directly on
  the analysis response. When the request hit a gateway timeout (long AI
  run), an upload-too-large rejection, or an expired session — all of
  which return an HTML page, not JSON — parsing threw the cryptic
  `Unexpected token '<', "<!DOCTYPE"...`. The dialog now reads the body
  defensively and shows a clear, status-aware message (timeout → try a
  smaller/focused source; 413 → file too large; 401/403 → session
  expired) instead of the raw parse error.

- **Duplicate / doubled links cleaned up.** Two separate causes made a
  component's Links look multiplied: (1) the same logical edge declared
  from both sides (this `reads-from` X + X `writes-to` this) was shown as
  two rows/edges, and the hero diagram drew a fresh box per link so one
  peer appeared several times; (2) genuinely redundant rows in the data
  (e.g. `part-of` the same target twice with different labels). Fixes:
  - The detail page now collapses mirror pairs correctly (via
    `LINK_ROLE_INVERSE`, not label-string matching) so an interaction
    shows **once** per component page, and de-dupes a component's own
    links; the hero diagram draws **one box per peer**.
  - The Consistency check's **Duplicate links** now treats containment
    (`part-of` / `contains`) as unique-per-target — it flags a second
    `part-of X` even when the name differs, and the fix keeps one.
    Non-containment roles still keep `name`, so two `reads-from X` for
    two different datasets are left intact.

- **Import redirect hit a 404.** After a single-component import the
  dialog pushed to `/component/<id>/edit`, but the edit route lives at
  `/edit/<id>` — the component saved fine yet the redirect 404'd (and
  logged it). Fixed the redirect path.

- **Settings toggles for Capabilities / Processes / NFR / Risks now
  actually show the card.** The four cards on the detail page were
  gated on both the Settings visibility flag AND data-presence
  (`component.processes && component.processes.length > 0`, etc.).
  Result: turning the toggle ON in Settings had no effect when the
  component had no data yet — the card stayed hidden, and the per-
  block Edit dialog the analyst would use to add the first entry was
  unreachable. Fix: drop the data-presence predicate from the card
  conditional, render the card whenever the Settings flag is on, and
  show an empty-state message inside that points at the Edit button.

- **Links card: target shows raw id instead of name on first paint.**
  The detail page renders the Links card before `/api/components`
  finishes loading the catalog snapshot used to resolve `target` →
  human name. The fallback path was treating "not yet loaded" the
  same as "really missing" — the analyst saw a red `missing` badge
  next to every link until the fetch finished. Added an explicit
  `allComponentsLoaded` flag: while loading we show the raw id with
  no badge; once loaded, only truly absent targets get the warning.

- **Component picker only showed 8 options.** When adding or editing
  a Link, the typeahead dropdown opened with at most the first 8
  components in the catalog and the rest were unreachable without
  typing. Cap raised to 500 (effectively unlimited for any real
  catalog; the dropdown is `max-h-64 overflow-y-auto` so the list
  scrolls). The analyst sees every option from the moment the
  dropdown opens.

### Added

- **Pilot feedback (the pilot) — composer & editor improvements.**
  - **Upload a BRD / document** in the Solution composer to pre-fill the
    description (PDF / text), reusing the rules-import extractors via a
    new `POST /api/extract-doc`; AI assist then works off the richer text.
  - **Order links** in the component editor and solution flows: **Sort
    A–Z** by target + manual **↑/↓ reorder** (makes duplicates obvious;
    order is preserved on save).
  - **Live flow preview in the editor** — the link/flow diagram updates
    as you edit, no save-and-go-back needed (component Links card +
    solution editor flows).
  (The composer already autosaves its draft, so a description isn't lost
  on navigating away.)

- **Agent rename + animated team progress.** Agents can be renamed inline
  on the Agents page (committed, version-bumped). And the **Agent team**
  DSD generation now shows a fancy progress modal — animated Writer &
  Critic avatars highlighting who is working, a phase stepper (Gathering
  facts → Writer drafting → Critic reviewing → Writer revising → Saving)
  and flowing connectors — so the analyst can see the AI team at work.

- **DSD agent team + library + feedback + coach training.** Big upgrade
  to DSD generation, all in-process via the corp LLM gateway (no outbound):
  - **Two modes** at generation: **Quick** (the existing draft → critic →
    revise, unchanged) and **Agent team** (writer & critic driven by
    configurable YAML agents — `agents/dsd-*.yaml`, with built-in
    defaults so it works before any are committed).
  - **DSD library** — every generated DSD is now persisted to the data
    repo (`dsd/<solutionId>/<id>.md` with YAML front-matter) and listed
    per solution in the Documentation tab: open (rich modal, Copy / Save
    as PDF), delete.
  - **Analyst feedback** — 👍/👎 + comment + optional suggested correction
    on each DSD, stored with the artifact (the training signal).
  - **Coach training (propose → approve → commit)** — a new **Agents**
    page + coach that reads accumulated feedback and proposes targeted
    improvements to the writer/critic prompts & "lessons"; you approve
    and it commits to the agent YAML (version-bumped, auditable in git).
  - New libs `agents.ts`, `dsd-store.ts`, `dsd-coach.ts`; extended
    `solution-dsd.ts`; endpoints under `/api/solutions/[id]/dsd/artifacts`
    and `/api/agents`. Reuses the existing job/progress + `GeneratedDocModal`.

- **Catalog: group by context.** The catalog's grouping is now a
  selector — **No grouping / Group by context / Group by type**. “By
  context” rolls each component up to its owning context (via the
  `part-of` / `contains` hierarchy, same rule as the architecture
  overview) and shows one section per context (with a link to it), plus a
  “No context” section for everything outside a hierarchy. Helps as the
  component count grows. (Replaces the old boolean group-by-type toggle.)

- **DSD generation is now an orchestrated, grounded flow.** Instead of a
  single prompt, the Detailed Solution Description runs a small in-process
  pipeline: the inventory, capability/process mapping, dependencies, NFR
  rollup, flows and diagram are computed **deterministically from the
  data** (so they can't be hallucinated) and handed to the model as
  verified facts; then **draft → critic → revise** (the critic checks the
  draft against those facts; up to 2 revise iterations). It runs as a
  detached job (`POST/GET /api/solutions/[id]/dsd`) so the multi-call
  flow survives the gateway request timeout, and the button shows live
  progress (Reading… → Drafting… → Reviewing… → Revising…). Uses the same
  corp LLM gateway. New `src/lib/solution-dsd.ts`.

- **Analyst quick-start guide (`/guide`).** A friendly one-pager (new
  top-nav **Guide** entry) for the pilot kickoff: the ideal flow
  (start a Solution → check components → create new ones if needed → put
  the detail/rules on the component), a “golden rule” callout, a
  what-and-why of each repo area (Components / Solutions / Processes /
  Diagrams), and a “first 15 minutes” checklist with quick links.

- **Solution DSD opens in the same rich doc modal as components.** The
  generated Detailed Solution Description now opens in a proper viewer
  (styled markdown + rendered mermaid) with **Copy Markdown** and **Save
  as PDF** (clean print window), matching the component documentation
  experience. Extracted into a reusable `components/GeneratedDocModal`
  (an optional Publish action is built in for a later Confluence-for-
  solutions hook). The Documentation tab now shows View / Regenerate.

- **Solutions — reminder that detail lives on the component.** Info notes
  in the composer (Skeleton step), the solution detail Members tab and the
  editor make clear that a solution only wires components together — a
  component's detailed functionality (logic, rules, NFR, capabilities,
  processes) is edited on the component itself; new components added in a
  solution are created as empty drafts to flesh out afterwards.

- **Solutions composer — description field + AI assist.** Step 1 (Intent)
  now has a **Description** textarea. With goal + description filled, a
  **Pre-fill with AI** button opens a modal that calls the LLM (the same
  client used elsewhere) with the intent plus the full catalog export
  (reuses `buildCatalogMarkdown`) and proposes the rest of the solution —
  delivered capabilities/processes, member components (chosen from real
  catalog ids), new components for gaps, and flows. After review, **Apply**
  pre-fills every wizard step (skeleton + flows) so the analyst only
  tweaks and creates. New endpoint `POST /api/solutions/ai-compose`;
  member/flow ids are validated against the catalog server-side.

- **Solutions are now editable and deletable.** The detail page gets
  **Edit** and **Delete** (with confirm) buttons. New editor at
  `/solutions/[id]/edit` to change details (name / status / owner / goal
  / description), delivers (capability & process chips), members
  (disposition, role, add existing or add brand-new, remove) and flows
  (add / remove). Saves via PUT with the loaded sha; brand-new members
  added in the editor are created as draft components on save. The
  delivers ChipPicker was extracted to a shared `components/ChipPicker`
  used by both the composer and the editor.

- **Solutions wizard — tidier delivers picker + manual new components.**
  Step 1's capability/process pickers now show selected chips on top
  (one-click remove), a search box to filter the (otherwise long) list,
  and a **+ Add “…”** action to create a capability/process that isn't in
  the catalog yet. Step 2 gains **Add a new component** (name + type) —
  a brand-new component declared straight in the composer; on Create it
  is added to the catalog as a draft, so it is then usable everywhere,
  including the component link editor.

- **Solutions — compose offerings from existing components (Phase 1).**
  New top-nav entry (between Catalog and Processes) and a `Solution`
  entity stored separately at `solutions/<id>.yaml` (references catalog
  components by id — many-to-many, so the component catalog stays clean).
  Phase 1 ships the foundation: types + enums, YAML serializer
  (`solution-yaml.ts`), store (`solutions.ts`), CRUD API
  (`/api/solutions`, `/api/solutions/[id]`), a Solutions list page and a
  read-only detail page (Overview with a member-scoped diagram, Members,
  Flows, Delivers, NFR & Risks), and the design doc `docs/SOLUTIONS.md`.
  The deterministic composer wizard and DSD generation land in later
  phases.
- **Solutions — click-first composer wizard (Phase 2).** `/solutions/new`:
  a 4-step wizard (Intent → Skeleton → Flows → Review) that needs almost
  no typing. A deterministic proposer (`solution-proposer.ts`) matches the
  delivered capabilities/processes against component metadata and proposes
  members (ranked, with a reason), flags gaps as new draft components, and
  seeds existing links between members. The analyst ticks/segments their
  way through; **Create** atomically creates approved gap components
  (`status: draft`, pre-filled to close the gap) then saves the solution.
  Same `Proposal` shape leaves the door open for an LLM proposer later.
- **Solutions — DSD generation + promote flows (Phase 3).** The solution
  detail page gains a **Documentation** tab that generates a **Detailed
  Solution Description (DSD)** by reusing the existing Generate pipeline's
  `detailed-solution` doc type (the same nicely-formatted generator used
  elsewhere); context = the solution YAML + its member components' YAML.
  The Flows tab gains **Promote proposed flows**
  (`POST /api/solutions/[id]/promote-flows`) which writes the proposed
  flows into the member components' real `links[]` and flips them to
  existing — the to-be becomes the as-is.

- **Processes overview page (`/processes`).** New top-nav entry next to
  Catalog. Aggregates every business process declared anywhere in the
  catalog (each component's `processes[]`) into one list, and shows
  per process which components support it and in what role
  (owner / participant / listener / trigger), with their activity.
  Filter box matches by process or component name; rows link to the
  component detail.

- **Consistency check now flags duplicate links.** A new **Duplicate
  links** category detects the same link (same `target` + `role` +
  `protocol` + `name`) declared more than once on a component — the
  one-click fix keeps the first occurrence and removes the rest
  (`dedupeLink`). It also fixes the list appearing to *multiply*:
  duplicate links used to emit the same mirror suggestion several times
  (the mirror id ignores `name`); issues are now deduped by id, so each
  gap shows once.

- **Partial / merge import (`onConflict: merge`).** A new **Merge
  fields** mode in the Import dialog patches only the top-level fields a
  YAML carries onto an existing component matched by `id` — e.g. paste
  just `id` + `nfr` to replace the NFR block and leave everything else
  intact. Implemented as merge-then-validate: the patch overrides the
  existing component's fields (shallow), the merged result is run
  through the full schema validator, then saved with the existing sha.
  Requires an `id` of an existing component (errors otherwise). Works
  per-document in a bundle too; the report lists the patched fields.

- **YAML export — single component and whole catalog.** A
  **Download YAML** button on the component detail page exports that
  component as its canonical v2 YAML; an **Export YAML** button in the
  catalog header exports the entire catalog as one round-trippable
  multi-document bundle (`---` separated). Both are byte-identical to
  what is written to disk (same `componentToYaml` serializer). Raw URLs
  for curl / automation: `GET /api/components/<id>/export` and
  `GET /api/admin/export-yaml`.
- **Bundle import + upsert.** The Import dialog now accepts a
  multi-document YAML bundle (and a `.yaml` file upload, alongside
  paste), so the whole catalog can be re-imported in one go. Each
  document is validated independently and shown with a per-document
  preview; the result is a created / updated / copied / skipped /
  errors report. New shared serializer module `src/lib/component-yaml.ts`
  (`normaliseForSave`, `componentToYaml`, `catalogToYaml`) and validator
  helpers `validateComponentObject` / `validateComponentDocs`.

- **`table` protocol on links + connectors.** Joins the existing
  protocol set (`rest / grpc / async / db / file / human / info /
  link / data`) for cases where the data flow targets a specific
  table rather than a database engine as a whole. ER-many arrow,
  orange (`#d97706`) — matches the existing `table` component-type
  palette. Wired into `LinkProtocol`, `CONNECTOR_TYPES`,
  `LINK_PROTOCOLS`, the form picker, the drawio library export, and
  the diagrams builder edge palette.

### Changed

- **Architecture overview groups by containment hierarchy.** The
  "Group by type" toggle (which dropped every `context` into one shared
  "Context" frame, scattering each context's members across other
  type frames) is replaced by **"Group by hierarchy"**: each component
  now nests inside the frame of what it is `part-of`, transitively —
  Boundary ⊃ Context ⊃ Application/Microservice/Service ⊃ Module (and
  Database ⊃ Schema ⊃ Table). The part-of / contains edges are no longer
  drawn — the nesting *is* the edge. Anything outside a hierarchy falls
  back to type clustering. `buildArchitectureMermaid`'s `groupByType`
  option became `groupByContainment`.

- **`docs/COMPONENT_MODEL.md` rewritten for schema v2.** The canonical
  LLM-facing schema reference still described the v1 shape
  (`interfaces[]` + `relationships[]` + `data{}`) it predated. Rewritten
  around the `links[]` primitive: the 6 roles and 3 mirror pairs
  (`calls`↔`serves`, `part-of`↔`contains`, `reads-from`↔`writes-to`),
  the 10 protocols, inverse display labels, the consistency mirror rule,
  a full v1→v2 migration table (including `data.owns` and the 16-value
  `DataKind` ontology being dropped), and a `links[]`-based annotated
  example + code-generator checklist. Backlinks section updated to the
  single `inbound-links` endpoint.
- **Import now updates existing components by default.** Previously the
  importer was create-only: an incoming `id` that already existed was
  auto-renamed to `-2`. The `/api/components/import` endpoint now takes
  an `onConflict` mode — **`update`** (default, overwrite the existing
  component with the same id, sha-aware), `create` (the old
  rename-to-`-2` behaviour), or `skip` — selectable in the Import
  dialog. This makes the YAML round-trip (export → edit → re-import) a
  true edit of existing components, not a duplicate.
- **Component serialization centralised.** `saveComponent` and every
  export path now share `src/lib/component-yaml.ts`; the `normaliseForSave`
  strip-and-stamp helper moved there out of `github.ts`. On-disk and
  exported YAML are guaranteed identical.

- **Technical + Business tabs collapse into one "Properties" tab.** The
  Technical (Links, NFR) and Business (Capabilities, Processes) tabs
  carried four cards between them — light enough to live on a single
  tab. They now share the new **Properties** tab. The `UIBlocksConfig`
  group keys (`technical`, `business`) are unchanged so existing
  `config.yaml` toggles keep working; only `BlockMeta.tab` and
  `DetailTabId` were updated.
- **Per-block edit dialogs.** Each card on the detail page (Description,
  Links, Capabilities, Processes, Rules, NFR, Risks) now exposes its
  own small `Edit` button that opens a focused modal — the analyst
  can fix one block without scrolling through the full Edit form. The
  modal reuses `ComponentForm` with a new `focusBlock` prop that
  hides every other section and the Basic Information header. The
  modal fetches a fresh copy of the component on open (sha-aware), the
  form saves through the existing PUT endpoint with the rest of the
  component carried over from `initialData`, and the parent detail
  page re-fetches on success so the new state shows up without a
  navigation. Full Edit (the `Edit` button in the page header) still
  works for identity-level fields and bulk edits.

### Fixed (more v2 fallout cleanup)

- **Confluence page renderer rewritten for `links[]`.** Every component
  published to Confluence had three separate tables — Interfaces,
  Relationships, Inputs & Outputs — driven by the legacy arrays. After
  Phase 1 + 2 those arrays read empty post-migration, so the
  Confluence page lost half its content on every re-publish. Replaced
  with a single **Links** table (role / protocol / target / name /
  description) backed by `component.links[]`. `RELATIONSHIP_LABELS` +
  `DATA_KIND_LABELS` imports retired.
- **Rules import context uses `links[]`.** The AI prompt that feeds the
  Pass-1 rules-import classifier was assembling its component
  fingerprint from `c.interfaces`, `c.data.inputs` and `c.data.outputs`.
  All three are dropped on read now, so the model saw empty fields and
  classified poorly. Replaced with a single "Links" line listing every
  edge with role + protocol + target + optional name.
- **Component form / detail page visibility flags consolidated.** The
  legacy `technical.interfaces` and `business.data` block flags pointed
  at cards that no longer exist. `BLOCK_METAS` keeps only the unified
  `technical.relationships` row (label renamed to **Links**) plus the
  surviving Business cards (Capabilities, Processes). The TypeScript
  `interfaces?` and `data?` keys stay on `UIBlocksConfig` so existing
  `config.yaml` entries still validate; they are simply ignored.
- **Hero context block description refreshed.** Settings UI now says
  "Auto-rendered mermaid combining every link from this component to
  its peers" instead of the old inputs / outputs / owned data wording.

### Deleted

- `src/app/api/components/[id]/inbound-interfaces/route.ts`
- `src/app/api/components/[id]/inbound-relationships/route.ts`
- `src/components/MultiComponentPicker.tsx`
  (Both inbound routes returned empty after the migration; the picker
  was used only by the v1 consumers field on `data.outputs`.)

### Fixed

- **Blast Radius scan ported to `links[]`.** Phase 1 + 2 retired
  `interfaces[]`, `relationships[]` and `data{}` but the blast-radius
  computation was still iterating `comp.relationships`, so every
  component's BlastRadius tab showed "0 impacted" after the refactor.
  Reverse index now scans `links[]`; severity is derived from
  `LinkRole` (calls / reads-from / writes-to / part-of → HIGH;
  contains → MEDIUM; serves → LOW). The detail dialog renders the
  `via` chip from `LINK_ROLE_LABELS` and shows the link protocol
  alongside.

### Changed

- **Draw.io export consolidates to one dialog.** The standalone
  `/export` page and the `Download Draw.io Library` button on the
  catalog header did the same thing (hit `GET /api/export/drawio`).
  Merged into a single `DrawioLibraryDialog` mounted on the
  **Diagrams** page header and on the component **Documentation**
  tab. The `Export` top-nav entry and the catalog header button are
  removed; `/export` route is deleted. One copy of the instructions
  (paired with the download button) lives inside the dialog.

### Refactor — Phase 2: `data{}` collapses into `links[]`

The final step of the v2 schema refactor. Every input / output now
lives as a link with role `reads-from` / `writes-to`; `data.owns` is
dropped entirely; the 16-value `DataKind` ontology is gone.

- **Migration rules** (`migrateToLinksV2` in `src/lib/github.ts`):
  - `data.inputs[name=X, source=B, purpose=P]` → `links[reads-from B, name=X, description=P]`.
  - `data.outputs[name=X, consumers=[B,C], purpose=P]` → two links: `[writes-to B, name=X]` and `[writes-to C, name=X]`.
  - `data.owns` → **dropped** (no edge target; source-of-truth semantics retire).
  - DataKind, source-of-truth marker, owns metadata — **not preserved**.
  - Orphan inputs (no source) and outputs without consumers are dropped.
- **Mirror pair extended:** `reads-from ↔ writes-to` added to `LINK_ROLE_INVERSE`. Consistency check matches mirrors on `(target, role, protocol, name)` so a data flow declared from both sides collapses to one edge, and a mismatched name surfaces as a missing-mirror finding.
- **UI dropped wholesale:**
  - Form: the entire "Inputs / Outputs / Owns" section is gone — every flow is a Link row now.
  - Detail page: "Inputs & Outputs" card and "Data referenced by other components" card both removed; the Links card surfaces inbound flow via inverted role labels (`reads-from` ↔ `writes-to`, `Read by` / `Written to by`).
  - Architecture overview: `Data flow` toggle dropped — `reads-from` / `writes-to` render under the Relationships toggle alongside the other structural roles.
  - Consistency Check: data category gone — one `Links` category covers every mirror check. Fix kinds `addOutput`, `addInput`, `addOutputConsumer`, `setInputSource` removed; only `addLink` remains.
  - Catalog Export: per-component Data flow block removed; Coverage matrix Data column dropped; cross-cutting external-target scan reads `links[]` exclusively.
  - Hero context diagram: simplified to a single ring of inbound/outbound links labelled by `name` or `protocol` or `role`. No more inputs / outputs / owns groupings.
- **Backbone cleanup:**
  - `GET /api/components/[id]/inbound-data` route deleted.
  - `buildIOMermaid` + `buildInterfacesMermaid` removed from `component-mermaid.ts`.
  - `DATA_KIND_*` constants stay in `constants.ts` for legacy YAML parsing in the Import dialog (deprecated; not surfaced in any UI).
  - Component type still carries `data?: ComponentData` as a `@deprecated` field so pre-v2 YAML still type-checks; `normaliseForSave` strips it on every write.

### Refactor — Phase 1: `links[]` replaces `interfaces[]` + `relationships[]`

The component schema gains a single edge primitive: `ComponentLink` with
six roles (`calls`, `serves`, `part-of`, `contains`, `reads-from`,
`writes-to`) and an optional `protocol`. The legacy `interfaces[]` and
`relationships[]` arrays migrate on read, get dropped from disk on
next save, and disappear from the UI entirely.

- **`schema_version: 2`** on every component as the migration marker.
  Read of v1 YAML auto-populates `links[]` from the old arrays; first
  save writes v2 and strips the legacy fields.
- **Migration rules** in `src/lib/github.ts` (`migrateToLinksV2`):
  `interfaces[provides]` → `links[serves]`,
  `interfaces[consumes]` → `links[calls]`,
  `relationships[parent-of]` → `links[contains]`,
  `relationships[child-of]` → `links[part-of]`,
  `relationships[depends-on / communicates-with / fallback]` → `links[calls]` (description preserves the legacy nuance),
  `relationships[reads-from]` → `links[reads-from]`,
  `relationships[writes-to]` → `links[writes-to]`.
  Dedup on `(target, role, protocol)` so a partial migration cannot
  duplicate entries.
- **Form** (`ComponentForm.tsx`): the separate "Interfaces" and
  "Relationships" sections collapse into a single **Links** card.
  Each row picks target (typeahead picker), role (6-value select),
  optional protocol, plus name + description.
- **Detail page** (`/component/[id]`): one **Links** card replaces the
  Interfaces card + Inbound interfaces card + Relationships card +
  Inbound relationships card. Outbound + inverted inbound merge into
  one list via `combinedLinks`; mirror pairs (calls↔serves,
  part-of↔contains) dedup so the analyst sees the edge once.
- **Inbound endpoint**: new `GET /api/components/[id]/inbound-links`
  replaces inbound-interfaces and inbound-relationships. Single scan
  over every other component's `links[]` looking for `target === id`.
- **Consistency Check**: categories collapse from {relationships,
  interfaces, data} to {links, data}. Mirror rule:
  `calls ↔ serves`, `part-of ↔ contains`. `reads-from` / `writes-to`
  stay directional (passive target). Fix kind `addLink` replaces
  `addRelationship` + `addInterface`.
- **Architecture overview**: edge collection iterates `links[]` and
  classifies by role — calls / serves render as the "Interfaces"
  edge family, the other four as "Relationships" edge family. Mirror
  pairs normalised so each architectural edge appears once.
- **Catalog Export**: per-component "Interfaces" + "Outbound
  relationships" sections merge into one "Links" section; inbound
  block now lists rows from `links[]` with inverse role labels.
- **Maturity scoring**: two fields (`Interfaces`, `Relationships`)
  collapse to one (`Links (relationships & interfaces)`). Existing
  totals adjust automatically.

`data{}` (inputs / outputs / owns) is intentionally **untouched**
in this phase — that's Phase 2.

### Added

- **Data Model Registry integration (read-only).** Components of type `table` can be linked to an entity in an external REST metadata service via a new `data_model.entity` field. The edit form gains a "Data model registry link" card and the detail page renders attributes + relationships fetched live from the registry — the catalog never copies the registry data into YAML so the registry stays the single source of truth. One-way pull only: arch-tool never writes back. Generic across vendors — the base URL, API path prefix, entity endpoint and relationships endpoint are all configurable so any standards-compliant REST metadata service fits.
- **Two auth modes for the registry, mirroring the LLM gateway adapter.** Static bearer token (`DATA_MODEL_REGISTRY_TOKEN`) for the quick-start path; OAuth 2.0 client_credentials (`DATA_MODEL_REGISTRY_OAUTH_*`) for production deployments behind an identity provider. The OAuth provider class is shared with the LLM adapter — token caching, proactive refresh and 401-driven invalidate-and-retry already work.
- **Data Model Registry healthcheck row in Settings.** Four-step probe (DNS → request → response → classify) identical to the LLM / Git / Confluence rows. When OAuth mode is on, the trace splits into "Phase: Token" + "Phase: Registry" so an operator can pinpoint whether the IdP, the credentials, the scope/audience binding, or the registry endpoint itself is at fault.

### Environment variables

**Added (all optional, drop-in safe defaults — existing `.env.local` works unchanged):**

| Variable | Default | When set | Purpose |
|---|---|---|---|
| `DATA_MODEL_REGISTRY_BASE_URL` | (unset) | always | Enables the integration. Leave empty to disable. |
| `DATA_MODEL_REGISTRY_API_PATH` | `""` | optional | Path prefix between base URL and the endpoint paths. |
| `DATA_MODEL_REGISTRY_ENTITY_PATH` | `/dataModel/version` | optional | Endpoint that returns `{ entity, attributes, version, zone }`. |
| `DATA_MODEL_REGISTRY_RELATIONSHIPS_PATH` | `/relationships` | optional | Endpoint that returns `{ relationships: [{parent, child, type}] }`. |
| `DATA_MODEL_REGISTRY_ZONE` | `PRD` | optional | Value passed as the `zone` query parameter on entity lookups. |
| `DATA_MODEL_REGISTRY_AUTH` | `bearer` | optional | `bearer` (static token) or `oauth` (client_credentials). |
| `DATA_MODEL_REGISTRY_TOKEN` | (unset) | when `AUTH=bearer` | Static bearer token. |
| `DATA_MODEL_REGISTRY_OAUTH_TOKEN_URL` | (unset) | when `AUTH=oauth` | OAuth token endpoint. |
| `DATA_MODEL_REGISTRY_OAUTH_CLIENT_ID` | (unset) | when `AUTH=oauth` | OAuth client id. |
| `DATA_MODEL_REGISTRY_OAUTH_CLIENT_SECRET` | (unset) | when `AUTH=oauth` | OAuth client secret. |
| `DATA_MODEL_REGISTRY_OAUTH_SCOPE` | (unset) | when IdP needs scope | Pass-through to the token request. |
| `DATA_MODEL_REGISTRY_OAUTH_AUDIENCE` | (unset) | when IdP needs audience | Pass-through to the token request. |

**Changed / Removed:** none.

- **Two extra component types: `service` and `table`.** `service` sits next to `microservice` for cases where the team distinguishes "a service" from "a microservice" (or where the analyst has not committed to either pattern yet). `table` sits next to `database` for catalogs that model individual database tables / collections / entities as first-class components instead of folding them into the parent database. Both ship with icons (`ServerCog`, `Table`), distinct colours (cyan-600 for service, amber-600 for table), and drawio styles + sizes so they render cleanly on the diagram builder and the catalog cards.
- **Generic `component` type as the new default.** New components default to type `Component` (a neutral catch-all) instead of `microservice` so an analyst who has not yet decided what shape the thing is can still create it without picking a specific architecture archetype. Existing components keep their type unchanged. Listed first in the type picker, paired with a neutral indigo style on diagrams.
- **Component id auto-generated from the name.** Only the **Name** field is required on the new-component form. The id is slugified from the name on save (lowercase, dashes for spaces, alphanumerics + dash / underscore only). An "Advanced — customize component id" expander lets the analyst override the slug. Edit mode shows the id as read-only because renaming the YAML file would invalidate every link to the component.
- **Unified `description.description` field.** The Description card on the form and the detail page now uses one textarea instead of two (Technical + Business). Existing components that store split `description.technical` / `description.business` are merged into the unified field at read time via `migrateComponent`, so old YAML keeps loading unchanged on disk. The next save persists only the unified field and drops the legacy ones; components that have never been re-saved still render correctly by falling back to the legacy fields in the detail view and in the catalog search.
- **Pull-smart now patches `description.description`.** The Confluence pull-smart flow recognises the unified field as a primary patch target. Legacy `description.technical` / `description.business` patches still work for Confluence pages whose structure has not been re-published.
- **Import component from YAML.** New `Import` button on the catalog header opens a paste-and-import dialog: the analyst pastes a single component as YAML (generated externally — by their LLM of choice, exported from another catalog, or hand-authored), an inline `Validate` runs the same schema checker the server uses, and `Import` writes the YAML through the existing git provider. Validation surfaces both errors (block the import) and warnings (unknown fields, legacy `business_capabilities`, `data_model` on a non-table type — import still proceeds). On id collision the server auto-appends `-2`, `-3`, … up to `-99` and the response carries the final id, so the redirect lands on the actual saved component. After save the user is taken to `/component/<id>/edit` to immediately tweak the imported entry. Only `name` is required; `id` is auto-slugified from the name when omitted.
- **Interface target — typeahead picker with optional catalog link.** The Interfaces editor on the component form replaces the plain text Target input with a typeahead that suggests existing components as you type (id and name match, arrow keys + Enter, click-to-pick), but still accepts free text on Enter / blur for external systems and partners not modelled in the catalog. The catalog list is fetched once and shared across all picker instances in the form. A small `linked` badge appears next to the input when the current value matches a known component id, so the analyst can tell at a glance whether the target will resolve.
- **Interface targets render as clickable links on the detail page.** When `interfaces[].target` matches a component id, the Interfaces card on `/component/<id>` renders the target with its type icon and a link straight to that component. Free-form labels render unchanged (plain monospace text with a tooltip explaining it's an external label).
- **Referenced by interfaces from … (backlinks).** A new card on the Technical tab lists every other component whose `interfaces[].target` points at the current one. Each entry shows the source component (name + type icon), the original direction (`provides` / `consumes` from the source's perspective), the connector type, and the interface description. Drives discoverability for "who's actually talking to me" without needing to scan the whole catalog. Backed by a new `GET /api/components/<id>/inbound-interfaces` endpoint that runs one catalog scan per request — gated by the same Interfaces visibility flag as the outbound list so the two halves stay together when an admin hides Interfaces in Settings.
- **Relationships pick from the same typeahead picker.** The relationship Target field in the component form now uses the same typeahead picker as interfaces, replacing the static `<Select>` dropdown. The dropdown is always current (catalog is fetched per form mount), shows the component type icon alongside the name and id, and still accepts free text on Tab / Enter for forward references to components not yet in the catalog.
- **Referenced by relationships from … (relationships backlinks).** Mirrors the interfaces backlinks: a card on the Technical tab lists every other component whose `relationships[].target` points at the current one. Each entry carries the source name + type icon, the relationship label from the source's perspective (e.g. `depends-on`), the connector, and the description. Backed by `GET /api/components/<id>/inbound-relationships`; gated by the Relationships visibility flag.
- **Outbound relationships flag broken targets.** The Relationships card on the detail page resolves each target against the live catalog. Matched targets render as a clickable row with the target's type icon and name. Unmatched targets render as a non-link block with the raw id and a red `missing` badge, so the analyst can spot stale references at a glance instead of clicking through to a 404.
- **New `schema` component type.** 20th type, sits next to `table` in the picker. Pink-on-magenta palette with a dashed border (renders distinct from regular tables in the diagram builder + drawio export), uses the `Braces` icon. Use it for JSON / Avro / Protobuf message contracts, OpenAPI / GraphQL schemas, DB-schema views — anything that describes *shape* rather than runtime storage.
- **Interface `name` field.** `interfaces[].name` is a new optional string for a short human label — "Orders API", "Stock checker", "Inventory snapshot". Surfaces on the detail page as the primary label with the description as muted context; pops up in the inbound-interfaces backlinks too. Older interfaces with only `description` keep the description as the primary label, so no on-disk migration is needed. The mermaid Visualize panels prefer name over connector type for edge labels.
- **New `data` connector type.** `data` joins `rest / grpc / async / db / file / human / info / link` as the 9th connector / interface type. Pink double-arrow style (mirrors the `schema` component palette) — for data-flow edges where a `data` interface is the right metaphor but `db` or `async` is misleading (e.g. parquet drop, snapshot transfer, ETL pipe). Wired into the form picker, the validator, the drawio library export, and the diagrams/builder edge palette.
- **Hero context diagram now includes interfaces and resolves names.** The Overview "Component context" mermaid renderer was missing the interfaces section entirely and was using raw component ids in relationship labels. Both fixed: interfaces render direction-aware between the component and its peers, all peer nodes display the human-readable component name when the target id matches a known component (falling back to the id for unmatched/external strings). The other Visualize panels (Interfaces, Relationships) take the same id→name lookup, so node labels are consistent across the detail page.
- **Data input `source` is a typeahead picker — and gains backlinks.** The "Source" field on `data.inputs` rows in the form is now a `ComponentTargetPicker` (same UX as interface targets and relationship targets): suggestions filter as the analyst types, picking from the dropdown stores the canonical component id, and free text is still accepted for sources that are not modelled in the catalog yet. On the detail page the source renders as a clickable row with the upstream component's type icon and name; a red `missing` badge surfaces stale references inline.
- **Data output `consumers` is a multi-pick chip editor.** Replaces the old comma-separated text input. Each consumer appears as a removable chip (with type icon + human name when it resolves to a known component); a single picker below adds the next one — pick from the dropdown to auto-add, or type and press Enter (or click Add) to commit free text. On the detail page consumers render as a row of links with the same TypeIcon + name treatment as the source field.
- **Data backlinks card on the Business tab.** Two grouped lists, both backed by the new `GET /api/components/<id>/inbound-data` endpoint: (1) *Downstream consumers* — components that named this one as `inputs[].source`, with the DataItem they receive; (2) *Upstream emitters* — components that named this one in `outputs[].consumers`, with the DataItem they push. Gated by the same Inputs & Outputs visibility flag as the outbound IO card.
- **Catalog view preferences persist across reloads.** Search query, type / status / owner / tag filters, view mode (grid / tiles / list) and the group-by-type toggle are now stored per-browser in `localStorage` under the `arch-tool:catalog:` prefix. Open a component, hit Back, refresh the tab, close and re-open the browser — the catalog comes back the way the analyst left it instead of resetting to grid + no filters every time. Backed by a new `useStoredState` hook in `src/lib/use-stored-state.ts` (defaults on SSR, hydrates on mount, persists on each change) — reusable from any client component that needs the same pattern.
- **Inbound relationships merge into the Relationships card.** Removed the standalone "Referenced by relationships from" card. Inbound relationships now appear inline in the regular Relationships section with their *inverse* label — so on a parent component's detail page, a child that declared `child-of: parent` shows up as **"Parent of: child"** alongside any explicit outbound entries. Driven by a new `INVERSE_RELATIONSHIP_LABELS` map in `src/lib/constants.ts` (`parent-of ↔ child-of`, `depends-on → required-by`, `reads-from → read-by`, `writes-to → written-to-by`, `fallback → has-fallback`, `communicates-with` symmetric). Dedupe key `displayLabel + target` so an edge that BOTH sides legitimately declared (e.g. A:parent-of:B + B:child-of:A) collapses to a single row with the outbound side winning. Inverse rows carry a hover tooltip "Declared on X — edit it there" so the analyst knows where to go to change the underlying YAML.
- **Hero context diagram includes inbound relationships.** The Overview "Component context" mermaid and the per-section Relationships visualizer both now receive the merged outbound + inverted-inbound list, so a parent component that has no explicit `parent-of` declarations but is targeted by `child-of` from several children draws those edges (with the inverse label) instead of looking falsely empty.
- **Fix: hydration error on the detail page.** The Status row in the Details card wrapped `<StatusBadge>` (which renders a `<div>` via shadcn `Badge`) inside a `<p>`. That is invalid HTML, and Next dev mode threw a hydration mismatch every time the page loaded. Switched the wrapper to a `<div>` with a top margin to keep the visual rhythm.
- **Fix: catalog preferences sometimes read as "still resetting".** The first version of `useStoredState` loaded the persisted value in a post-mount `useEffect`, which meant the very first render always showed the default and snapped to the stored value one paint later — and the in-between frame read as "the page didn't remember". Rewritten with a synchronous `useState` initialiser that reads `localStorage` on the client's first render (and falls back to the supplied default on the server). The persisted filters / view mode / grouping now appear on the first paint, with no flash, when the user navigates back to `/`.
- **Catalog Consistency Check.** New `Consistency check` button on the catalog header runs a deterministic backlink audit across the whole repo. Scans every component, surfaces one row per missing backlink with a per-row `Fix` button (and a bulk `Apply all`). Categories: **Relationships** (parent-of ↔ child-of, communicates-with ↔ communicates-with — the other relationship types stay directional by design), **Interfaces** (provides ↔ consumes on the same connector type and target — mirror interface inherits the original's name / description), **Data flow** (inputs[].source ↔ outputs[].consumers — matching DataItem name; auto-adds the missing output / input / consumer / source). Each fix is one atomic patch to one target YAML, committed through the existing git provider with optimistic concurrency on the sha. The apply endpoint re-runs the scan on every call and looks up the issue by stable id, so a double-click or a race against another path returns 404 idempotently instead of double-applying. Backed by `src/lib/consistency.ts` (pure detection + fix), `GET /api/admin/consistency-check` and `POST /api/admin/consistency-check/apply`.
- **Architecture overview — one-click full-catalog diagram.** New `Architecture overview` button on the catalog header opens a near-fullscreen modal with a mermaid flowchart of every component and the edges between them. Four toggles select what to show — **Relationships** (solid arrows, inverse pairs deduped so `A:parent-of:B + B:child-of:A` collapse to one), **Interfaces** (dotted arrows, normalised consumer → provider so `provides` + `consumes` mirrors collapse), **Data flow** (thick arrows, `inputs[].source` and `outputs[].consumers` deduped into source → consumer edges), **Group by type** (wraps each type's nodes in a labelled subgraph). Nodes are coloured by `TYPE_COLORS` — same palette as the catalog cards and the drawio export. Toggle preferences persist per browser via `useStoredState`. `Copy Mermaid` in the footer lifts the chart source for pasting into mermaid.live or any markdown doc. Pure string producer in `src/lib/architecture-mermaid.ts` — no new API surface; the dialog reuses `GET /api/components`.
- **Component Type Model help dialog refreshed for the current 20-type schema.** The "?" dialog on the catalog header was still describing the old 16-type set and listed Database as a standalone leaf. Restructured into three sections: **Org hierarchy** (Boundary → Context → {Application, Microservice, Service} → Module — `service` slots in next to microservice as the more permissive shape for "a service that isn't strictly a microservice"); **Data hierarchy** (Database → Schema → Table, where Schema is the database namespace / contract sense — JSON / Avro / Protobuf / OpenAPI also fit as a standalone Schema); **Standalone** (Component as the catch-all default, plus Frontend / Cache / Queue / Data Pipeline / Batch Job / Storage / Gateway / External / Platform / Library). The subtitle now reads "20 component types" and each section carries a one-paragraph explanation of what its tree means.
- **Component Data Model reference doc.** New canonical schema reference in `docs/COMPONENT_MODEL.md` (660 lines) designed as a self-contained system prompt for any LLM that authors / migrates / audits component YAML. TypeScript types for every shape, enum tables (20 types, 9 connectors, 16 data kinds, all role enums), required / default / validation rules, mirror & inverse semantics with explicit guidance not to defensively declare both sides, full backward-compat migration table, an annotated YAML example, and a pre-emit checklist for code generators.
- **Catalog Export (LLM-friendly).** New `Export for LLM` button on the catalog header opens a near-fullscreen modal containing the entire catalog rendered as a single markdown document with **every field of every component shown — including the empty ones**. Empty fields are flagged explicitly with `❌ NOT SET` / `❌ NONE DEFINED` / `❌ NONE` so a model reading the export can answer "where are the gaps?" at the same time as "what do we have?". Structure: header → at-a-glance summary (counts by type / status / owner, average maturity, repo-wide gap stats per field) → coverage matrix (one-line-per-component overview) → cross-cutting index (capabilities, processes, external / unknown targets referenced) → per-component detail block (identity + description + interfaces + outbound relationships + inbound backlinks + capabilities + processes + rules + data flow + NFR + diagram + risks + missing-field summary). Footer offers `Copy all`, `Download .md` and a `Raw URL` link that hits `GET /api/admin/export-catalog` so the same payload is reachable from `curl` or any non-UI pipeline. Pure string producer in `src/lib/catalog-export.ts`.

### Fixed

- **Operational logs now actually populate `app.YYYY-MM-DD.jsonl`.** v0.5.0 shipped the file sink and the Admin console's Operational logs tab, but most API routes were still emitting their errors through `console.error`/`console.warn` (which only lands on stdout) instead of `getLogger()`. As a result, the file sink was being written for LLM calls and admin actions only, and the Operational tab stayed empty on file-sink deployments. This release replaces every server-side `console.*` in `src/lib/*` and every API route with `getLogger()` equivalents, and wraps every route handler in `withRouteContext` so an `info` entry per mutating request and a `debug` entry per `GET` are emitted automatically. The `app` stream now reflects real traffic.

## [0.5.0] — 2026-05-25

Observability + code release. Two themes:

1. **Structured logging + Admin console.** Every server-side log line is a JSON object; per-day per-stream files capture operational events, full LLM call traces and the admin audit trail. A new `/admin` route (gated by the existing `SITE_PASSWORD`) browses all three with filters and search. The LLM tab exports selected calls as OpenAI fine-tuning JSONL with one click — built for the corp use-case where a non-vanilla LLM behind a gateway needs prompt tuning.

2. **Rules-import from source code.** Third tab in the import wizard alongside PDF and Confluence — paste source code or upload a single file (.java / .cs / .py / .js / .ts / .go / .sql / .cob / .pli / ...). The two-pass AI pipeline reuses the same Pass 1 relevance filter and Pass 2 structured extractor, with code-aware prompts that ignore plumbing and translate code into business terms.

All features are additive — your existing `.env.local` keeps working unchanged. Four new optional environment variables are documented below.

### Added

- **Structured JSON logging.** Every server-side log line is a JSON object with `ts`, `level`, `requestId`, `user`, `route`, `msg` and (optional) `meta`. Three streams: operational entries (`app.*.jsonl`), LLM call traces (`llm.*.jsonl`), admin audit trail (`admin-actions.*.jsonl`). Per-day rotation by filename. Configurable level (`LOG_LEVEL`) and sink (`LOG_SINK=stdout|file|both`) with file output rooted at `LOG_PATH`.
- **Full LLM call traces.** Every `complete()` call writes a log entry with provider, model, full prompt + response (when `LLM_LOG_FULL=true`, default), latency, and ok/err. Designed for fine-tuning analysis — the Admin console exports selected entries as OpenAI fine-tuning JSONL (`{messages: [{role:"user", content:prompt}, {role:"assistant", content:response}]}`) ready to upload as the `purpose: "fine-tune"` input.
- **Admin console at `/admin`.** Every logged-in user (already gated by `SITE_PASSWORD`) can browse three tabs:
  - *LLM calls* — filter by user / route / provider / OK-or-failed / full-text; click any row to expand the full prompt + response side-by-side with copy buttons; multi-select + Export as fine-tuning JSONL or raw JSONL.
  - *Operational logs* — filter by level / user / route / search; click an entry to expand its `meta` block.
  - *Admin audit* — every privileged action: `storage.init`, `config.save`, `lock.acquire`, `lock.denied`, `lock.release`, `llm.export`.
- **Request correlation IDs.** Every request gets an `x-request-id` (mint a fresh UUID when the reverse proxy did not set one). All log lines from the same request share the id so a failing chain can be reconstructed end-to-end.
- **Front-end error reporter.** `window.onerror` + `unhandledrejection` ship to `/api/client-log`; entries land in `app.*.jsonl` with `meta.source: "client"` so the Admin console shows them alongside server logs. De-duplicated within a 5-second window so a render loop cannot flood the sink.
- **Secret redaction across the logger.** `Authorization` headers, `client_secret`, `access_token`, `id_token`, `refresh_token` and OpenAI/GitHub key patterns are masked to a short `prefix…****suffix` hint before any sink writes them. Applied to log messages, meta objects, and the body excerpts inside LLM trace entries.
- **Rules-import from source code.** A third tab in the import wizard — paste source code or upload a single file — sends it through the same two-pass pipeline as PDF/Confluence with a code-aware prompt. Pass 1 surfaces business-logic blocks while ignoring plumbing (logging, DI, HTTP routing, tests, getters/setters, imports); Pass 2 translates them into the existing `ComponentRule` schema, with formulas extracted as plain algebraic expressions, if/else mapped to Given/When/Then, and validators as constraints. Verbatim source excerpt is kept as `evidence`.
- **Language detection for code uploads.** Filename extension is mapped to a language slug (Java, Kotlin, C#, Python, JS/TS, Go, Rust, Ruby, PHP, Swift, C/C++, SQL, PL/SQL, COBOL, PL/I, Scala, Groovy, Lua, R, Perl, shell, PowerShell, Dart) and passed to the LLM as a hint; the user can override via a dropdown.

### Environment variables

**Added (all optional, drop-in safe defaults — existing `.env.local` works unchanged):**

| Variable | Default | When set | Purpose |
|---|---|---|---|
| `LOG_LEVEL` | `info` | always | `debug` / `info` / `warn` / `error` |
| `LOG_SINK` | `stdout` | always | `stdout` / `file` / `both` |
| `LOG_PATH` | `./logs` | when `LOG_SINK` is `file` or `both` | Absolute path of the JSONL log directory |
| `LLM_LOG_FULL` | `true` | always | `true` keeps full prompts+responses for fine-tuning analysis; `summary` keeps only metadata |

**Changed / Removed:** none.

## [0.4.0] — 2026-05-25

Shared-team release. Two themes:

1. **Filesystem storage backend** — third `GIT_PROVIDER` option that
   stores the catalog directly under a configured directory (local
   disk, network share, NAS mount) instead of pushing through a remote
   Git API. Same store layer as the other providers; switching is an
   env change + restart. History is kept as JSONL sidecars so the
   History tab still works without a Git remote.

2. **Hard edit lock for multi-user filesystem deployments** — one user
   at a time owns the edit form for a given component. The second user
   opens the page in read-only mode with a banner naming the current
   editor. TTL 10 minutes, heartbeat-renewed while the edit page is
   open; explicit "Release lock" button + auto-release on save and on
   navigate-away. Locks are filesystem-only; remote-Git providers
   continue to rely on optimistic concurrency at save time.

Plus an OAuth 2.0 client_credentials mode for the openai-compatible
LLM provider — enterprise gateways behind any identity provider
(Entra ID, Okta, Auth0, Keycloak, AWS Cognito, ...) now work
out-of-the-box; the token URL is explicit so no vendor is assumed.

All features are additive — no v0.3.0 deployment has to change anything.

### Added

- **Filesystem storage backend.** Third `GIT_PROVIDER` option (`filesystem`, also `fs` / `file`) stores the catalog directly under a configured directory — local disk, network share, NAS mount — instead of pushing through a remote Git API. Set `FS_STORAGE_PATH` to an absolute path. The store layer (components, diagrams, Confluence-link side-files) is identical to the Git-backed providers so the rest of arch-tool is unchanged. Atomic writes via temp file + rename. Optimistic concurrency uses a SHA-256 of the current file content as the opaque revision token; mismatch on save returns 409 and the UI offers the user a Reload / Cancel choice.
- **Hard edit lock for multi-user filesystem deployments.** When two analysts share a filesystem storage root, only one can hold the edit form for a given component at a time. The second user opens the page in read-only mode and sees a banner with the current editor's name and acquisition time. Lock TTL is 10 minutes, refreshed by a heartbeat every 5 minutes while the edit page is open; a successful save and an explicit "Release lock" button both free it immediately. The hash-based optimistic-concurrency check at the provider level remains the safety net for the few corner cases where a lock cannot be honoured (TTL expired mid-save). Locks are filesystem-only — remote Git providers continue to rely on optimistic concurrency at save time, as before.
- **Per-file JSONL history sidecar** under `_history/{path}.jsonl` on the filesystem backend. Each save / delete appends one entry (timestamp, user, message, action) so the History tab on the component detail page still works on filesystem deployments — no real Git remote needed for an audit trail.
- **`X-Forwarded-User` reader for multi-user deployments.** When a corporate reverse proxy authenticates the user upstream and injects an identity header, arch-tool reads it for edit-lock ownership and history sidecar entries. Header name is configurable via `USER_HEADER`. Falls back to `anonymous` when no header is present.
- **"Initialize storage" button in Settings.** When the filesystem healthcheck reports a missing sub-directory layout under a freshly-mounted storage root, the Settings page surfaces a one-click button that creates `components/`, `diagrams/`, `confluence-links/`, `_history/` and `_locks/` in one POST. No `mkdir` from the shell required.
- **Filesystem-shaped diagnostic probe.** `probe()` on the filesystem provider returns a four-step trace — resolve, access, contents, write-test — instead of DNS / request / response, so the operator can pinpoint exactly which check failed: path not found, not a directory, no read/write, missing sub-directories, write-test failed (disk full, quota, permissions).
- **OAuth 2.0 client_credentials authentication for the openai-compatible LLM provider.** Enterprise gateways that sit behind an identity provider can now be used as a drop-in for a static API key. Setting `LLM_OAUTH_TOKEN_URL` switches the adapter into OAuth mode; `LLM_API_KEY` is then ignored. The token URL is explicit so the adapter stays vendor-agnostic — Microsoft Entra ID, Okta, Auth0, Keycloak, AWS Cognito and self-hosted OpenID Connect IdPs all fit. Optional `LLM_OAUTH_SCOPE` and/or `LLM_OAUTH_AUDIENCE` are passed through to the token request. Tokens are cached in memory and refreshed proactively 5 minutes before expiry; concurrent callers share one in-flight refresh; 401 from the gateway invalidates the cache and retries once.
- **Two-phase diagnostic probe for OAuth.** In OAuth mode the Settings health check runs DNS / request / response / classify against the IdP token endpoint first, then again against the gateway with the freshly-minted bearer. The trace is rendered with a "Phase: Token" / "Phase: Gateway" heading so a verbose probe pinpoints whether the failure is in the IdP, the credential, the scope/audience binding, or the gateway itself. Bearer tokens never leave the server in the trace — `access_token`, `id_token` and `refresh_token` values in the token response body are masked before they enter the response excerpt, and the request body (which carries `client_secret`) is never echoed.

## [0.3.0] — 2026-05-21

Corporate-debugging release. Two themes:

1. **AI rules import.** A Rules & Calculations analyst can now feed the
   tool a PDF or a Confluence page and have the AI propose rule
   candidates pre-shaped for the existing schema. A two-pass pipeline
   keeps it practical on long documents — Pass 1 filters to passages
   relevant to the active component, Pass 2 extracts structured
   candidates. The analyst reviews, edits and selectively imports;
   duplicates are flagged and unchecked by default.

2. **Verbose connection diagnostics.** Health checks now describe what
   they are about to do (URL, endpoint, masked credential hint, scheme)
   and return a four-step probe trace (DNS → request → response →
   classify). Failures classify into nine specific categories —
   including a dedicated `tls` category that points at
   `NODE_EXTRA_CA_CERTS` for the common corporate case where curl
   works but Node does not trust the internal CA. The deepest
   `err.cause` is unwrapped so the trace shows the real Node code
   (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `ECONNREFUSED`,
   `ERR_TLS_CERT_ALTNAME_INVALID`, etc.) instead of the generic
   "fetch failed".

Both features are additive — no v0.2.0 deployment has to change anything.

### Added

- **AI rules import from PDF or Confluence.** Rules & Calculations tab gains an "Import from documents" button that opens a wizard: choose a PDF (≤ 12 MB) or paste a Confluence page URL / page id, the server extracts text, then runs a two-pass AI analysis — Pass 1 filters the document down to passages relevant to the active component (skipped for documents under ~20K chars where it wastes more than it saves), Pass 2 emits structured rule candidates that match the existing `ComponentRule` schema (formula / Given-When-Then / constraint). Every candidate is editable (name, kind, summary, formula or G/W/T fields, description), shows a confidence badge, the source section, and a verbatim evidence quote; candidates the AI thinks duplicate an existing rule are flagged and unchecked by default. Import is append-only — selected candidates are merged onto the component and persisted through the existing PUT /api/components/[id] save flow, complete with sha optimistic concurrency. Hard cap at 320,000 input characters (~80K tokens, ~80 pages of text) — over-cap documents are rejected with a clear message before any LLM call.
- **Verbose connection diagnostics in Settings.** Health checks now return a sanitized connection self-description (provider, base URL, endpoint template, repo / space / model, auth scheme, credential hint with `prefix…****suffix` masking) plus a four-step probe trace (DNS → request → response → classify). Failed probes auto-expand and surface an error category (`tls`, `connect`, `auth-401`, `forbidden-403`, `not-found-404`, `rate-limit-429`, `server-5xx`, `dns`, `parse`, `http-other`) and a category-specific hint. The Response and Headers sections are inspectable in collapsible panels, so debugging an external integration no longer needs a separate curl session. Secrets are never returned in full from the server — `Authorization` and `x-api-key` headers are masked before they leave the route.
- **TLS vs connect classification on fetch failure.** When Node's `fetch()` fails, the probe now walks the `err.cause` chain and surfaces the real Node error code (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `ECONNREFUSED`, `CERT_HAS_EXPIRED`, `ERR_TLS_CERT_ALTNAME_INVALID`, etc.) instead of the generic "fetch failed". A dedicated `tls` category covers cert-chain failures with a hint pointing at `NODE_EXTRA_CA_CERTS` — the standard fix for corporate networks with an internal CA where curl works but Node does not.

## [0.2.0] — 2026-05-19

Multi-backend release. Every external integration the catalog touches —
LLM, Git, Confluence — now ships with two adapters and a clean env-var
switch between them, so the tool fits a corporate stack (Azure DevOps +
on-prem Confluence + internal LLM gateway) as cleanly as the original
home stack (GitHub + Atlassian Cloud + Anthropic direct). Plus a
team-wide Settings page, in-product health checks for every provider,
explicit rule ordering, and a Next.js 15 upgrade. No deployment on
v0.1.0 has to change anything — every new option defaults to the v0.1.0
behaviour.

### Added

- Pluggable LLM provider — choose Anthropic Claude (default) or any OpenAI-compatible gateway via `LLM_PROVIDER`. The OpenAI-compatible adapter works with OpenAI, Azure OpenAI, OpenRouter, Together, Groq, LiteLLM, Portkey, Cloudflare AI Gateway, Ollama, LM Studio, vllm, etc.
- Pluggable Git backend — choose GitHub (default) or Azure DevOps via `GIT_PROVIDER`. The ADO adapter supports both Azure DevOps Service and on-prem Server/TFS via `ADO_BASE_URL`, authenticated with a Personal Access Token.
- Pluggable Confluence edition — choose Cloud (default, v2 + Basic auth) or Data Center / Server (v1 + Bearer PAT) via `CONFLUENCE_EDITION`. Same publish, pull-smart and "open in Confluence" flows across editions.
- Optional `config.yaml` at the root of the data repo with `llm.model` to set the active model without a redeploy.
- **Reorder rules** — ChevronUp / ChevronDown buttons next to each rule in the edit form. Order persists in the YAML `rules[]` array so sequence-dependent rules (base rate → adjustment → override) can be modelled explicitly.
- **Settings page (`/settings`)** — hide individual blocks on the component detail page (15 blocks across 8 tabs: Hero context diagram, Details, Descriptions, Risks, Interfaces, Relationships, NFR, Capabilities, Data Perspective, Processes, Rules tab, Blast Radius tab, Documentation tab, Diagrams tab, History tab). One config applies to every component for the whole team — saved in `ui.blocks` of `config.yaml` via the active Git provider. Tabs whose blocks are all hidden disappear from the tab strip.
- **Health checks in Settings** — per-provider "Test" buttons plus a "Run all" shortcut probe LLM (1-token completion), Git (lists `components/` tree) and Confluence (search for a non-existent title) and surface the active provider/edition, model, branch and round-trip latency.

### Upgrades

- Next.js 14.2.35 → 15.5.18. No app-level code changes were needed — the route handlers were already on the new async `params` signature.
- `@anthropic-ai/sdk` 0.80.0 → 0.91.1.
- `eslint-config-next` aligned with Next 15.
- TypeScript `target` bumped to `ES2017` (auto-applied by Next 15 for top-level `await`).
- Dependency vulnerabilities cut from 6 high / 10 moderate / 3 low down to 2 moderate (both transitive postcss inside Next.js — not exploitable in this codebase, no clean upstream fix).

### Changed

- `ANTHROPIC_API_KEY` is now required only when `LLM_PROVIDER=anthropic` (still the default). The OpenAI-compatible adapter uses `LLM_BASE_URL` + `LLM_API_KEY` instead.
- The store layer (`src/lib/github.ts`) now reads and writes through a provider abstraction (`src/lib/git/`) so the existing 12 API routes work identically against either backend.

## [0.1.0] — 2026-05-18

First public release. Free software under MIT.

### Catalog

- Component model with 16 types, status, owner, tags, three audience descriptions.
- Rich modelling: `capabilities` (with role: owner / contributor / consumer / indirect), `data` (inputs / outputs / owned data, kinds across Format / Business / Technical groups), `processes`, `rules` (formula / Given-When-Then / constraint), NFR fields, interfaces, relationships.
- Catalog views: grid / tile / list, group-by-type toggle, search and filter (type / status / owner / tags).
- Drawio export of the full component library as `mxlibrary` XML.

### Detail page

- 7-tab layout: Overview · Technical · Business · Rules & Calculations · Blast Radius · Documentation · Diagrams · History.
- Identity panel with type, status, owner, tags and a documentation maturity bar (13 fields scored).
- Hero "Component context" mermaid diagram combining inputs, outputs, owned data and direct relationships.
- Per-section "Visualize" toggles for Interfaces, Relationships, Capabilities and Inputs & Outputs.

### AI features

- Documentation Generator with three audiences (Technical / Business / Executive) and three doctypes (Detailed Solution / Audit Report / Security Report). Optional PDF / ERD / BPMN attachments enrich the prompt. Model: Claude Sonnet 4.
- Blast Radius analysis: reverse-graph BFS over relationships, severity classification, NFR gap detection, confidential-data flags. Plus one-click AI Impact Memo.
- Pull-smart: Claude scan of a Confluence page proposes per-field patches (scalar fields plus indexed `rules[N].field` paths) with confidence levels and evidence quotes. User approves per-patch, then committed to the data repo.

### Confluence integration

- Publish: renders structured Component Reference (At a glance · Capabilities · Interfaces · Relationships · I/O · Processes · Rules · NFR · Risks) as native Confluence tables and panel macros. Mermaid blocks stripped (no plugin assumed). Hierarchy mirrors the first capability — capability parent pages are lazy-created.
- Open in Confluence / Pull from Confluence / Publish to Confluence buttons all live on the Documentation tab.
- Page identification by side-file (`confluence-links/{id}.json` in the data repo) with title-based fallback if the side-file write fails.

### Diagrams

- WYSIWYG drawio builder with drag-and-drop palette of pre-styled component types and eight typed connectors (REST / gRPC / Async / DB / File / Human / Info / Link).
- Diagrams stored as `.drawio` XML in `diagrams/` in the data repo.
- Per-diagram preview rendered as mermaid (drawio → mermaid converter).
- Cross-link: each component's Diagrams tab lists every diagram that references it (matched by `arch_id`).

### Infrastructure

- Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui + Radix.
- Git as the only persistent store — no database.
- Password gate via `middleware.ts` (single-tenant).
- In-memory rate limiter (5 requests / minute / IP) on AI endpoints.
- Public architecture overview at `/architecture.html`.

### Project

- MIT license.
- Architecture-questions checklist and 6-phase port plan for moving the app into a corporate environment.
- Best-effort maintenance model documented in README.

[Unreleased]: https://github.com/jazzwedz/arch-tool/compare/v0.9.1...HEAD
[0.9.1]: https://github.com/jazzwedz/arch-tool/releases/tag/v0.9.1
[0.9.0]: https://github.com/jazzwedz/arch-tool/releases/tag/v0.9.0
[0.8.3]: https://github.com/jazzwedz/arch-tool/releases/tag/v0.8.3
[0.8.2]: https://github.com/jazzwedz/arch-tool/releases/tag/v0.8.2
[0.8.1]: https://github.com/jazzwedz/arch-tool/releases/tag/v0.8.1
[0.8.0]: https://github.com/jazzwedz/arch-tool/releases/tag/v0.8.0
[0.7.1]: https://github.com/jazzwedz/arch-tool/releases/tag/v0.7.1
[0.7.0]: https://github.com/jazzwedz/arch-tool/releases/tag/v0.7.0
[0.6.1]: https://github.com/jazzwedz/arch-tool/releases/tag/v0.6.1
[0.6.0]: https://github.com/jazzwedz/arch-tool/releases/tag/v0.6.0
[0.5.0]: https://github.com/jazzwedz/arch-tool/releases/tag/v0.5.0
[0.4.0]: https://github.com/jazzwedz/arch-tool/releases/tag/v0.4.0
[0.3.0]: https://github.com/jazzwedz/arch-tool/releases/tag/v0.3.0
[0.2.0]: https://github.com/jazzwedz/arch-tool/releases/tag/v0.2.0
[0.1.0]: https://github.com/jazzwedz/arch-tool/releases/tag/v0.1.0
