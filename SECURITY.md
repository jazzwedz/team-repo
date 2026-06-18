# Security Policy

## Reporting a vulnerability

If you discover a security issue in Team Repository, please **do not open a
public GitHub issue**.

Instead, report it privately via GitHub's [Security Advisories](https://github.com/jazzwedz/arch-tool/security/advisories/new)
feature, or email the maintainer at **jasenovec@gmail.com** with subject
`[security] Team Repository: <short description>`.

Please include:

- A description of the issue and its potential impact.
- Steps to reproduce, if possible.
- Affected versions / commit SHAs.
- Any proof-of-concept code or screenshots.

## Response expectations

Team Repository is maintained on a **best-effort** basis by a single person.

- We aim to acknowledge reports within **5 working days**.
- We aim to provide an initial assessment within **14 days**.
- We will keep you informed about the fix timeline and credit you in the
  release notes (unless you prefer to remain anonymous).

We do not have a bug bounty programme.

## Supported versions

Only the `main` branch is actively maintained. Previous tagged releases are
not patched.

## Scope

In scope:

- The Team Repository application code in this repository.
- The default deployment configuration (`Dockerfile`, environment variables,
  middleware).

Out of scope:

- Vulnerabilities in upstream dependencies (please report those to the
  respective projects). We track them via Dependabot.
- Issues in self-hosted deployments caused by misconfiguration (e.g., a
  public `arch-data` GitHub repo, leaked API tokens).
- Social engineering of maintainers or users.
- Denial of service that requires unrealistic request volumes.

Thank you for helping keep Team Repository and its users safe.
