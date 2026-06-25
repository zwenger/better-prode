# better-prode

**A fast, self-hostable World Cup prediction pool — edge-native, free-tier friendly, and open source.**

[![CI](https://github.com/zwenger/better-prode/actions/workflows/ci.yml/badge.svg)](https://github.com/zwenger/better-prode/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

---

## What is this?

**better-prode** is a World Cup prediction pool ("prode") you can clone and run on your own Cloudflare account in under 30 minutes.

The original inspiration — [prodeenlinea.com](https://prodeenlinea.com) — collapses under match-time traffic, organizes predictions by group instead of by match, and doesn't show you what others in your pool bet. This fixes all of that:

- Predictions are per-match, not per-group — the natural unit for a World Cup pool.
- Results settle at the edge via Cloudflare Durable Objects, so a single busy full-time moment doesn't take the site down.
- The leaderboard is edge-cached and invalidated on settlement, not recomputed on every pageload.
- It runs entirely on free tiers (Cloudflare Workers, Turso free plan) for a typical pool of friends.

---

## Features

| Feature | Details |
|---------|---------|
| Google sign-in | OAuth 2.0 via Better Auth; user records in your own DB |
| Per-match predictions | One score prediction per (user, match), editable until T−5min |
| Server-authoritative lock | Deadline enforced server-side — no client-clock spoofing |
| Scoring: pleno system | 0 / 1 / 3 / 4 / 7 pts — outcome, exact goals, and both for pleno |
| Groups | Create, invite, join, manage members (owner / admin / member roles) |
| Leaderboard | Per-group standings, cached at the edge, updated seconds after settlement |
| In-progress view | See same-group predictions once a match kicks off |
| Pre-kickoff reminders | Push notifications for pool members who haven't predicted yet |
| Hybrid result ingestion | Auto (Football-Data.org or API-Football) + manual admin backstop |
| "Manual wins and pins" | Admin can override and lock a result; the API will never overwrite it |

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | [TanStack Start](https://tanstack.com/start) (SSR + file-based routing) |
| Runtime | [Cloudflare Workers](https://workers.cloudflare.com/) + [Durable Objects](https://developers.cloudflare.com/durable-objects/) |
| Database | [Turso](https://turso.tech/) (libSQL / SQLite) |
| Auth | [Better Auth](https://www.better-auth.com/) + Google OAuth |
| UI | [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) |
| Testing | [Vitest](https://vitest.dev/) (unit + workers pool) + [Playwright](https://playwright.dev/) (E2E) |
| Bundler | [Vite](https://vitejs.dev/) + [@cloudflare/vite-plugin](https://www.npmjs.com/package/@cloudflare/vite-plugin) |

---

## Run your own

### Prerequisites

Before you begin, you need accounts and credentials from these services:

| Service | What you need | Free tier? |
|---------|--------------|-----------|
| [Cloudflare](https://dash.cloudflare.com/) | Account + Wrangler CLI authenticated | Yes |
| [Turso](https://app.turso.tech/) | Database URL + auth token | Yes |
| [Google Cloud](https://console.cloud.google.com/apis/credentials) | OAuth 2.0 Client ID + Secret | Yes |
| [Football-Data.org](https://www.football-data.org/) | API token | Yes (free tier) |
| [API-Football](https://www.api-football.com/) | API key (optional, alternative provider) | Free tier available |

Node.js 22+ is required. Use the `.nvmrc` file: `nvm use`.

---

### Step-by-step setup

#### 1. Clone and install

```bash
git clone git@github.com:zwenger/better-prode.git
cd better-prode
npm ci
```

#### 2. Configure environment variables

```bash
cp .dev.vars.example .dev.vars
```

Open `.dev.vars` and fill in every value. Each variable has an inline comment with exactly where to find it and how to generate it.

Key variables:

```bash
# Generate a new secret — do not reuse one from elsewhere
BETTER_AUTH_SECRET=$(openssl rand -base64 32)

# Generate a new VAPID keypair for push notifications
npx web-push generate-vapid-keys
```

#### 3. Create the Turso database and run migrations

```bash
# Create a database (Turso CLI)
turso db create better-prode

# Get the connection URL and token
turso db show better-prode --url
turso db tokens create better-prode

# Add them to .dev.vars, then run migrations
npm run db:migrate

# Seed fixture data (teams, matches) for local development
npm run db:seed
```

#### 4. Create the Cloudflare KV namespace

The leaderboard edge cache uses a KV namespace. Create it and update `wrangler.jsonc`:

```bash
npx wrangler kv namespace create LEADERBOARD_CACHE
# Copy the returned id into wrangler.jsonc → kv_namespaces[0].id
```

#### 5. Start the development server

```bash
npm run dev
# App is at http://localhost:3000
```

#### 6. Deploy to Cloudflare

Set production secrets before deploying:

```bash
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put TURSO_DATABASE_URL
npx wrangler secret put TURSO_AUTH_TOKEN
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put FOOTBALL_DATA_API_TOKEN
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
```

Then deploy:

```bash
npm run deploy
# Runs: vite build && wrangler deploy
```

Update your Google OAuth redirect URI to `https://<your-worker>.workers.dev/api/auth/callback/google`.

---

## Architecture overview

The domain (scoring, lock rule, result application) is a pure TypeScript hexagonal core with no infrastructure dependencies. Everything time-sensitive flows through an injectable `Clock` port. All result settlement funnels through a single `applyMatchResult` choke point serialized by a per-match Durable Object — this prevents double-computation and absorbs the match-end thundering herd.

```
Client → TanStack Start SSR (Cloudflare Worker)
              │
              ├─ Turso (libSQL) — relational reads, leaderboard SUM
              ├─ Per-match Durable Object — single-flight applyMatchResult + reminder alarms
              └─ KV — edge-cached leaderboard, invalidated on settlement
```

Full design and architectural decisions: [`openspec/changes/world-cup-prode-mvp/design.md`](openspec/changes/world-cup-prode-mvp/design.md)

All specs: [`openspec/`](openspec/)

---

## Testing

```bash
# Unit tests — domain logic, adapters (Node environment)
npm test

# Unit tests with coverage report
npm test -- --coverage

# Cloudflare Workers runtime tests — Durable Objects, KV
npm run test:workers

# E2E tests — requires a running app and real credentials (see playwright.config.ts)
npm run test:e2e

# Type checking
npm run typecheck

# Linting
npm run lint
```

Coverage thresholds: 80% minimum on domain, adapters, and infra layers.

The project follows **Strict TDD**: write a failing test before writing implementation. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide: environment setup, testing expectations, commit convention, and PR workflow.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

---

## License

[MIT](LICENSE) — Copyright (c) 2026 zwenger
