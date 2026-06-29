# Contributing to better-prode

Thank you for taking the time to contribute. This document covers everything you need to get from a clean clone to an open pull request.

## Table of Contents

- [Development environment](#development-environment)
- [Testing](#testing)
- [Commit convention](#commit-convention)
- [Branch and PR workflow](#branch-and-pr-workflow)
- [Spec-driven development](#spec-driven-development)

---

## Development environment

### Prerequisites

| Tool      | Version              | Notes                                    |
| --------- | -------------------- | ---------------------------------------- |
| Node.js   | 22+                  | Use `.nvmrc` — run `nvm use` in the root |
| npm       | bundled with Node 22 | `npm ci` for reproducible installs       |
| Wrangler  | bundled as dev dep   | `npx wrangler` or `npm run deploy`       |
| Turso CLI | latest               | `brew install tursodatabase/tap/turso`   |

### Setup

```bash
# 1. Clone and install
git clone git@github.com:zwenger/better-prode.git
cd better-prode
npm ci

# 2. Create your local env file
cp .dev.vars.example .dev.vars
# Edit .dev.vars — see each variable's inline comment for where to get it.

# 3. Set up the local database
npm run db:migrate     # applies pending db/migrations/*.sql, tracked by schema_migrations
npm run db:seed        # seeds fixture data for development

# 4. Start the dev server
npm run dev            # Vite + TanStack Start on http://localhost:3000
```

> Wrangler reads `.dev.vars` automatically when running `wrangler dev`.
> For `npm run dev` (Vite), copy the same variables into `.env` if needed.

---

## Testing

This project enforces **Strict TDD**: write a failing test _before_ writing implementation. PRs that add behavior without corresponding tests will be asked to add them before merge.

### Test layers

| Command                | Runtime                          | What it covers                                                 |
| ---------------------- | -------------------------------- | -------------------------------------------------------------- |
| `npm test`             | Node (Vitest)                    | Domain logic, adapters, utilities                              |
| `npm run test:workers` | Cloudflare workerd (Vitest pool) | Durable Objects, KV bindings                                   |
| `npm run test:e2e`     | Playwright                       | Full browser flows (requires a running app + real credentials) |

### Coverage

Unit tests enforce an 80% minimum on `src/domain/**`, `src/adapters/**`, and `src/infra/**`. CI will fail if coverage drops below threshold.

### E2E

E2E tests use Playwright (`playwright.config.ts`). They require a running application and populated `.dev.vars`. They are **not** run in CI automatically — see the commented placeholder in `.github/workflows/ci.yml`.

---

## Commit convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

```
<type>(<optional scope>): <short description>

[optional body]

[optional footer(s)]
```

### Types

| Type       | When to use                        |
| ---------- | ---------------------------------- |
| `feat`     | New user-visible feature           |
| `fix`      | Bug fix                            |
| `chore`    | Maintenance, deps, tooling         |
| `refactor` | Code change with no behavior delta |
| `test`     | Adding or improving tests          |
| `docs`     | Documentation only                 |
| `ci`       | CI/CD pipeline changes             |
| `perf`     | Performance improvement            |

**Do not** include `Co-Authored-By` AI attribution lines in commits.

Examples:

```bash
feat(predictions): lock prediction entry 5 minutes before kickoff
fix(leaderboard): handle null points during active match
chore: upgrade wrangler to 4.70
test(scoring): add pleno edge case for 0-0 draw
```

---

## Branch and PR workflow

1. Fork the repository (external contributors) or create a branch directly (collaborators).
2. Branch naming: `<type>/<short-description>` — e.g., `feat/group-invitations`, `fix/lock-clock-drift`.
3. Open a pull request targeting `main`.
4. All CI checks must be green before merge: **lint**, **typecheck**, **test** (with coverage), **build**.
5. At least one review approval is required.
6. Squash or rebase merges are preferred to keep the history linear.

Use the pull request template (`.github/PULL_REQUEST_TEMPLATE.md`) — fill in every section.

---

## Spec-driven development

Planning artifacts live in `openspec/`. Before opening a PR for a non-trivial feature:

1. Check `openspec/changes/` for an existing spec covering the area.
2. If implementing a spec task, reference the task ID in your commit or PR description.
3. New features that change the domain model should be accompanied by or preceded by a spec update.

The full architecture and design rationale for the MVP is in `openspec/changes/world-cup-prode-mvp/design.md`.
