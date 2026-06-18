# Team Repository

AI-powered architecture catalog for a single team — components, capabilities, data flows, business rules and Confluence sync, all kept as YAML in a Git repo.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/jazzwedz/arch-tool/actions/workflows/ci.yml/badge.svg)](https://github.com/jazzwedz/arch-tool/actions/workflows/ci.yml)
![Status: best-effort](https://img.shields.io/badge/status-best--effort-blue)

---

## What is this?

A lightweight architecture catalog for **one team** (DEVs + BAs together), not an enterprise EA tool. Capture every component your team owns — its API surface, its data, its capabilities, its business rules, its risks — and turn that into living documentation:

- Browse the catalog like a service portal.
- Generate audience-tailored docs (Technical / Business / Executive) with Claude.
- Publish them to Confluence as proper pages with tables and panels — and pull edits back into the catalog via an AI patch flow.
- Analyse blast radius: pick a component and see what would break if it failed.
- Draw drawio diagrams that use your catalog as a palette.

Live demo: <https://arch-tool-jaso.up.railway.app/> (password-protected single-tenant demo).
Architecture overview: <https://arch-tool-jaso.up.railway.app/architecture.html>

## Features

- **Component catalog** — 19 component types (generic Component / Service / Microservice / Frontend / Database / Table / Cache / Queue / ...), status, owner, tags, free-form description. New components need only a name — the id is auto-generated from it.
- **Rich modelling** — `capabilities` (with role: Owner / Contributor / Consumer / Indirect), `data` (inputs / outputs / owned, 16 kinds across Format / Business / Technical), `processes`, `rules` (formula / Given-When-Then / constraint), NFR, interfaces, relationships.
- **AI documentation generation** — Claude Sonnet 4. Audience-tailored or doctype (Audit / Security / Detailed Solution). Optional PDF / ERD / BPMN attachments enrich the prompt.
- **Bidirectional Confluence sync** — publish renders structured tables and coloured panel macros; pull-smart compares page edits against the YAML and proposes per-field patches with confidence + evidence.
- **Blast Radius analysis** — reverse-graph BFS over relationships; severity per relationship type; NFR gaps and confidential-data flags; one-click AI Impact Memo.
- **WYSIWYG diagram builder** — drag pre-styled components onto a drawio canvas; 8 typed connectors; save to repo as `.drawio` XML.
- **Hero context diagram** — auto-rendered mermaid combining inputs / outputs / owned data / relationships per component.
- **Documentation maturity score** — 13-field score with banded labels (Skeletal / Drafted / Solid / Complete).

## Quickstart

Prerequisites: Node.js 20+, an empty Git repository for your catalog data (GitHub or Azure DevOps), an LLM API key (Anthropic Claude or any OpenAI-compatible gateway), optionally a Confluence Cloud account.

```bash
git clone https://github.com/jazzwedz/arch-tool.git
cd arch-tool
npm install
cp .env.local.example .env.local
# edit .env.local with your tokens (see "Configuration" below)
npm run dev
# open http://localhost:3000
```

The catalog itself lives in a **separate Git repo** (the `arch-data` pattern). Point the app at any empty Git repo you own — components, diagrams and Confluence link side-files are committed there.

## Configuration

All configuration via environment variables (`.env.local` for dev, your platform's secret store for prod). See [`.env.local.example`](.env.local.example) for the full list.

### Required

| Variable | Purpose |
|---|---|
| `GIT_PROVIDER` | `github` (default) or `ado` |
| `GITHUB_TOKEN` + `GITHUB_OWNER` | Required when `GIT_PROVIDER=github` |
| `ADO_BASE_URL` + `ADO_PROJECT` + `ADO_REPO` + `ADO_PAT` | Required when `GIT_PROVIDER=ado` |
| `LLM_PROVIDER` | `anthropic` (default) or `openai-compatible` |
| `ANTHROPIC_API_KEY` | Required when `LLM_PROVIDER=anthropic` |
| `LLM_BASE_URL` + `LLM_API_KEY` | Required when `LLM_PROVIDER=openai-compatible` |
| `SITE_PASSWORD` | Shared password gate (basic single-user auth) |

### Optional — Data Model Registry integration

Read-only, one-way pull from an external REST metadata service that exposes entity definitions + entity-to-entity relationships. When configured, components of type **table** get a "Data model registry link" card on the edit form (enter the entity name) and a "Data model registry" card on the detail page that fetches attributes and relationships live from the registry. The catalog stores only the entity name; the registry remains the source of truth.

| Variable | Purpose |
|---|---|
| `DATA_MODEL_REGISTRY_BASE_URL` | Base URL of the registry. Leave empty to disable the integration. |
| `DATA_MODEL_REGISTRY_API_PATH` | API path prefix appended after the base URL (optional). |
| `DATA_MODEL_REGISTRY_ENTITY_PATH` | Endpoint path for entity lookup. Default `/dataModel/version`. |
| `DATA_MODEL_REGISTRY_RELATIONSHIPS_PATH` | Endpoint path for relationships lookup. Default `/relationships`. |
| `DATA_MODEL_REGISTRY_ZONE` | Active zone passed as the `zone` query parameter. Default `PRD`. |
| `DATA_MODEL_REGISTRY_AUTH` | `bearer` (default) or `oauth`. |
| `DATA_MODEL_REGISTRY_TOKEN` | Static bearer token (when `AUTH=bearer`). |
| `DATA_MODEL_REGISTRY_OAUTH_TOKEN_URL` + `_CLIENT_ID` + `_CLIENT_SECRET` + optional `_SCOPE` / `_AUDIENCE` | OAuth 2.0 client_credentials (when `AUTH=oauth`). Same shape as the LLM gateway adapter. |

Diagnostics: the Settings page health-check panel gains a "Data model registry" row that probes DNS → request → response → classify, plus a second phase against the IdP token endpoint when running in OAuth mode.

### Logging and Admin console

Default behaviour: JSONL log lines on stdout, `info` level, full LLM prompts + responses captured. Drop-in safe for any deployment. To enable the Admin console (`/admin`) to browse logs and inspect LLM calls, switch on the file sink:

```bash
LOG_SINK=both           # or "file" for file-only
LOG_PATH=C:\arch-tool-logs
LOG_LEVEL=info          # debug | info | warn | error
LLM_LOG_FULL=true       # "summary" to drop prompt+response bodies
```

Three per-day streams when the file sink is on:

| File pattern | Content |
|---|---|
| `app.YYYY-MM-DD.jsonl` | Operational logs (debug / info / warn / error), including front-end errors shipped via `/api/client-log` |
| `llm.YYYY-MM-DD.jsonl` | One entry per LLM `complete()` call — provider, model, full prompt + response (when `LLM_LOG_FULL=true`), latency, ok/err |
| `admin-actions.YYYY-MM-DD.jsonl` | Audit trail — storage init, settings save, lock acquire / deny / release, LLM exports |

Secrets are redacted before they hit any sink — `Authorization` headers, `client_secret`, `access_token`, `id_token`, `refresh_token` and OpenAI / GitHub-style key patterns are masked to a short prefix+suffix hint.

The Admin console (`/admin`) is available to every logged-in user (gated only by `SITE_PASSWORD`). Three tabs:

- **LLM calls** — recent calls with full prompt + response side-by-side, copy buttons, "Export selected" emits OpenAI fine-tuning JSONL (`{messages: [{role:"user", content:prompt}, {role:"assistant", content:response}]}`) ready to upload as the `purpose: "fine-tune"` input.
- **Operational logs** — filter by level / user / route / full-text search. Click an entry to expand its `meta` block.
- **Admin audit** — every privileged action with who/when/what.

### Git storage backend

Three adapters ship in the box:

- **`github`** — uses Octokit. Set `GITHUB_TOKEN` (fine-grained PAT, Contents R/W), `GITHUB_OWNER`, optionally `GITHUB_REPO` (default `arch-data`) and `GITHUB_BRANCH` (default `main`).
- **`ado`** — Azure DevOps Git, works with both Azure DevOps Service and on-prem Server/TFS. Auth: Personal Access Token via Basic auth. Set `ADO_BASE_URL` (`https://dev.azure.com/{your-org}` or `https://your-tfs/{collection}`), `ADO_PROJECT`, `ADO_REPO`, `ADO_PAT`, optionally `ADO_BRANCH` (default `main`). The PAT needs at least "Code (Read & Write)" scope.
- **`filesystem`** — store the catalog directly under a configured directory (local SSD, network share, NAS mount). Set `FS_STORAGE_PATH` to an absolute path. The directory must already exist; sub-directories (`components/`, `diagrams/`, `confluence-links/`, `_history/`, `_locks/`) are created on demand from a one-click button in Settings. History is captured as JSONL sidecars under `_history/`. Concurrent edits are prevented by a hard per-component edit lock with a 10-minute TTL (heartbeat-renewed while the edit page is open); the user identity is read from a request header — `X-Forwarded-User` by default, configurable via `USER_HEADER` — so a reverse proxy doing Kerberos / SAML / OIDC fits in cleanly.

The store layer (components, diagrams, Confluence-link side-files) is identical across providers — switching backends only requires changing env vars and restarting.

### LLM provider

Two adapters ship in the box:

- **`anthropic`** — calls Claude directly via the Anthropic SDK. Default. Set `ANTHROPIC_API_KEY`; optionally `ANTHROPIC_MODEL` (falls back to a built-in default).
- **`openai-compatible`** — calls any service that exposes the OpenAI Chat Completions protocol. Set `LLM_BASE_URL` (e.g. `https://api.openai.com/v1`, your gateway, or a self-hosted endpoint). Covers OpenAI, Azure OpenAI, OpenRouter, Together, Groq, LiteLLM, Portkey, Cloudflare AI Gateway, Ollama, LM Studio, vllm, etc. Optionally set `LLM_MODEL`.

  Two authentication modes:

  - **Static API key (default):** set `LLM_API_KEY` to a long-lived bearer token the gateway accepts directly.

  - **OAuth 2.0 client_credentials:** for enterprise gateways that sit behind an identity provider. Setting `LLM_OAUTH_TOKEN_URL` switches the adapter into OAuth mode; the static key is then ignored. The token URL is explicit so any standards-compliant IdP fits:

    | IdP | `LLM_OAUTH_TOKEN_URL` | Additional |
    |---|---|---|
    | Microsoft Entra ID | `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` | `LLM_OAUTH_SCOPE=api://{your-app-uri}/.default` |
    | Okta | `https://{your-org}.okta.com/oauth2/default/v1/token` | `LLM_OAUTH_SCOPE={your-scope}` |
    | Auth0 | `https://{your-tenant}.auth0.com/oauth/token` | `LLM_OAUTH_AUDIENCE={your-api-identifier}` |
    | Keycloak / OpenID Connect | `https://your-idp.example.com/realms/{realm}/protocol/openid-connect/token` | `LLM_OAUTH_SCOPE={your-scope}` |
    | AWS Cognito | `https://{your-domain}.auth.{region}.amazoncognito.com/oauth2/token` | `LLM_OAUTH_SCOPE={resource-server}/{scope}` |

    Always required: `LLM_OAUTH_CLIENT_ID` and `LLM_OAUTH_CLIENT_SECRET`. Set scope or audience (or both) depending on what your IdP expects. Tokens are cached in memory and refreshed proactively 5 minutes before expiry; a 401 from the gateway invalidates the cache and retries once.

Model name can also live in `config.yaml` at the root of your data repo (overrides env):

```yaml
llm:
  model: claude-sonnet-4-20250514   # or gpt-4o, etc.
```

### Optional — Confluence integration

If unset, Publish / Pull / Open in Confluence buttons are hidden. Two editions are supported, picked via `CONFLUENCE_EDITION` (defaults to `cloud`).

**Cloud (default)** — v2 REST API + Basic auth (email + API token):

| Variable | Purpose |
|---|---|
| `CONFLUENCE_EDITION` | `cloud` (default) |
| `CONFLUENCE_BASE_URL` | `https://<your-site>.atlassian.net` |
| `CONFLUENCE_EMAIL` | Atlassian account email |
| `CONFLUENCE_API_TOKEN` | API token from `id.atlassian.com/manage-profile/security/api-tokens` |
| `CONFLUENCE_SPACE_ID` | Numeric ID of the target space |
| `CONFLUENCE_SPACE_KEY` | Space key (used for nicer URLs) |
| `ARCH_TOOL_PUBLIC_URL` | Public URL of your deployment (linked from Confluence pages) |

**Data Center / Server** — v1 REST API + Bearer Personal Access Token:

| Variable | Purpose |
|---|---|
| `CONFLUENCE_EDITION` | `datacenter` (also accepts `server`, `dc`) |
| `CONFLUENCE_BASE_URL` | `https://confluence.your-company.com` |
| `CONFLUENCE_PAT` | Personal Access Token, create at `<BASE>/plugins/personalaccesstokens/usertokens.action` |
| `CONFLUENCE_SPACE_KEY` | Target space key (primary identifier on DC) |
| `ARCH_TOOL_PUBLIC_URL` | Public URL of your deployment |

## Deployment

The app is a standard Next.js 14 deployment — anything that runs Node.js works.

- **Docker** — see [`Dockerfile`](Dockerfile):

  ```bash
  docker build -t team-repository .
  docker run --rm -p 3000:3000 --env-file .env.local team-repository
  ```

- **Railway** (used by the demo) — push to GitHub, set env vars in the dashboard, auto-deploy on `main`.

  [![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https://github.com/jazzwedz/arch-tool)

- **Vercel** — works out of the box for Next.js.

  [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/jazzwedz/arch-tool)

The catalog uses GitHub as storage, so there is no database to run.

## Architecture

A single-page visual overview lives at `/architecture.html` in the running app, and statically at [`public/architecture.html`](public/architecture.html) in this repo. It covers:

- Tech stack (7 layers)
- App map (routes + API endpoints + integrations)
- Component model (every YAML field)
- The 7 tabs on the detail page
- Feature highlights
- Confluence integration flow
- Deployment env vars
- Roadmap to port the app into a corporate environment

## Tech stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Radix · lucide-react · mermaid · marked · react-markdown · octokit · `@anthropic-ai/sdk` · js-yaml. No database — Git is the catalog.

## Maintenance & contributions

This project is maintained on a **best-effort basis** by one person, in spare time. Expect:

- Pull requests reviewed when there is time — typically within a couple of weeks.
- Issues triaged as time allows. Please search before opening a new one.
- No promised release cadence — releases happen when features stabilise.
- No bug bounty.

Contributions are welcome, especially:

- Bug fixes with a clear reproduction
- Documentation improvements
- New storage adapters (GitLab, Bitbucket, internal Git providers)
- New LLM adapters (Azure OpenAI, Bedrock, local models via Ollama)

By contributing you certify your work under the project's [MIT License](LICENSE).

Security issues — please follow [SECURITY.md](SECURITY.md) (do not open public issues).

## License

[MIT](LICENSE) — do whatever, just keep the copyright notice.
