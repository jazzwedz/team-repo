# Contributing to Team Repository

Thanks for considering a contribution! This is a best-effort, one-person project, so the rules are deliberately light.

## Before you start

- For **bug fixes**: open an issue first if it's not obvious, then a PR.
- For **small docs / typo fixes**: just open a PR.
- For **new features or refactors**: open an [issue](https://github.com/jazzwedz/arch-tool/issues) or a [discussion](https://github.com/jazzwedz/arch-tool/discussions) first to align on scope. PRs that show up unannounced for non-trivial changes may sit unreviewed for a long time.
- For **security issues**: see [SECURITY.md](SECURITY.md). Do not open a public issue.

## Dev setup

Prerequisites: Node.js 20+, a GitHub PAT with Contents R/W on a test data repo, an Anthropic API key. Confluence credentials are optional.

```bash
git clone https://github.com/jazzwedz/arch-tool.git
cd arch-tool
npm install
cp .env.local.example .env.local
# fill in your values
npm run dev
```

## Quality gates

Before pushing:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
npm run build       # production build
```

CI runs the same three on every PR.

## Code style

- TypeScript everywhere — no plain `.js` for source files.
- ESLint defaults (`next/core-web-vitals`).
- Two-space indentation. No semicolons-at-EOL preference is enforced — match the surrounding file.
- Prefer small, focused components; lift state up only when needed.
- Names: kebab-case for component IDs, camelCase for variables, PascalCase for React components and types.

## Commit messages

Conventional Commits style:

```
<type>(<scope>): <short summary>

<body — why, not what>

Closes #123
```

Types we use: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `ci`, `style`.

Scope is optional but helpful, e.g. `feat(confluence): ...`, `fix(blast-radius): ...`.

## Pull request flow

1. Fork the repo, create a feature branch off `main`.
2. Make focused changes — one PR per logical change.
3. Run the quality gates above.
4. Open a PR. Fill in the template.
5. Wait for review. Don't take silence personally — this is a side project.

## Adding a new adapter

The project is structured so that the three external dependencies (storage, LLM, Confluence) have adapter-friendly boundaries:

- **Storage** — `src/lib/github.ts` is the current implementation. A future refactor will lift its interface into `StorageClient`. New adapters (GitLab, Bitbucket, internal Git) would implement that.
- **LLM** — `@anthropic-ai/sdk` is called directly in three route handlers. A future `LLMClient` interface will accept alternative gateways (Azure OpenAI, Bedrock, Ollama).
- **Confluence** — `src/lib/confluence.ts` already follows an adapter shape. Cloud v2 is the only implementation today; DC v1 is welcome.

If you're starting work on one of these adapters, open a discussion first so we agree on the interface.

## DCO

By contributing, you certify that:

- The contribution was created in whole or in part by you, and you have the right to submit it under the MIT license; or
- The contribution is based upon previous work that, to the best of your knowledge, is covered under an appropriate open-source license, and you have the right under that license to submit that work with modifications.

You don't need to sign anything — opening a PR is the certification.

## License

By contributing, you agree your work will be released under the project's [MIT License](LICENSE).
