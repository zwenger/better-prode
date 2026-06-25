# Tasks: Tournament Data Ingestion (FIFA API)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 950–1 200 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 |
| Delivery strategy | stacked-to-main |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Ports + FifaAdapter mapping (no DB, no Workers) | PR 1 → main | Pure TS; fixtures; zero infra deps |
| 2 | Idempotent import command + demo-seed removal | PR 2 → main | Drizzle upsert; CLI script; integration test vs :memory: |
| 3 | Team flags component | PR 3 → main | flag-icons dep; React component; isolated |
| 4 | MatchDO → applyMatchResult (Turso) + live-results trigger | PR 4 → main | Workers pool tests; completes PR1 stub |

---

## Phase 1 — Ports & Anti-Corruption Layer (PR 1)

- [ ] 1.1 **[RED]** Write `src/domain/ports/tournament-source.test.ts` — assert `TournamentSource` interface shape: `fetchStructure(competitionId, seasonId)` returns `TournamentStructure` with `teams[]` and `matches[]`; each team has `id`, `name`, `code: string | null`; each match has `id`, `homeTeamId`, `awayTeamId`, `kickoffUtc` (ISO UTC), `status`, `homeScore`, `awayScore`, `group`, `stage`.
- [ ] 1.2 **[GREEN]** Create `src/domain/ports/tournament-source.ts` — export `TournamentTeam`, `TournamentMatch`, `TournamentStructure` types and `TournamentSource` interface; satisfy 1.1.
- [ ] 1.3 **[RED]** Write `src/adapters/result-source/fifa.test.ts` — import fixture `__fixtures__/wc2026-matches.json` (recorded snapshot); assert `FifaAdapter` maps `IdMatch` → `id` with prefix `fifa-m-`, `Home/Away.IdTeam` → `*TeamId` with prefix `fifa-t-`, `Date` → `kickoffUtc` UTC ISO 8601, `Home/Away.Score` → score integers, `GroupName` → `group`, `IdStage` → `stage`; assert status code `3` → `in_progress`; assert known finished code → `finished`; assert any unknown code → `scheduled` + `warned: true` flag in output; assert `ResultSource.getResult` returns `MatchResult` with `source: "auto"`.
- [ ] 1.4 Record fixture files: `src/adapters/result-source/__fixtures__/wc2026-matches.json` (in-progress match), `wc2026-finished.json` (finished match), `wc2026-upcoming.json` (upcoming match) — these are one-time API snapshots against `api.fifa.com` comp 17/season 285023; commit as static JSON; all subsequent tests use only these.
- [ ] 1.5 Create `src/adapters/result-source/fifa-iso.ts` — export `FIFA_ISO_MAP: Record<string, string>` keyed by FIFA `IdTeam` string; include all 48 WC2026 team ids with their ISO 3166-1 alpha-2 codes; unknown ids → `null` (no throw); document gaps as `// TODO: confirm` comments.
- [ ] 1.6 **[RED]** Add tests in `src/adapters/result-source/fifa.test.ts` for ISO mapping: known FIFA team id → correct ISO code; unknown id → `null`; import never throws on unmapped id.
- [ ] 1.7 **[GREEN]** Create `src/adapters/result-source/fifa.ts` — `FifaAdapter` class; implements `TournamentSource` and `ResultSource`; all FIFA JSON parsing confined here; `mapStatus(code: number): { status: MatchStatus; warned: boolean }` with exhaustive table (`3 → in_progress`; known finished code → `finished`; SAFE-DEFAULT: unknown → `scheduled + warned`); `fetchStructure` uses `AbortController` timeout 8 s; defensive per-field parse (missing/garbage → skip record + warn, never throw full import); `getResult` maps single match from `IdMatch`; satisfy 1.3 + 1.6.
- [ ] 1.8 **[RED/GREEN]** Add `mapStatus` table-completeness test: assert every currently-known FIFA status code (0, 1, 3, 12) maps to an explicit non-`warned` value; assert any integer outside that set maps to `{ status: "scheduled", warned: true }`.

---

## Phase 2 — Idempotent Import Command (PR 2)

- [ ] 2.1 **[RED]** Write `src/adapters/tournament-import/import.test.ts` — use local libSQL `:memory:` + Drizzle migrations; call `importTournament(structure, db)` twice with same fixture data; assert row counts unchanged (no duplicates); assert re-run with updated `kickoffUtc` updates the value; assert `homeScore`/`awayScore`/`status` NOT overwritten by import (result fields untouched); assert unmapped team emits warning in return value.
- [ ] 2.2 **[GREEN]** Create `src/adapters/tournament-import/import.ts` — `importTournament(structure: TournamentStructure, db: DrizzleClient): Promise<ImportResult>`; Drizzle `insert().onConflictDoUpdate()` on PK for `tournament`, `team`, `match`; PK format: `fifa-m-{IdMatch}` / `fifa-t-{IdTeam}`; `team.code` set from `fifa-iso.ts` lookup; `match` conflict update: `kickoffUtc`, `group`, `stage` only (never score/status/settledAt); `ImportResult` contains `{ upsertedTeams, upsertedMatches, warnings: string[] }` (unmapped team ids in warnings); satisfy 2.1.
- [ ] 2.3 **[RED]** Add idempotency test for tournament row: run import twice → `tournament` table has exactly 1 row; second run returns same `upsertedTeams` count.
- [ ] 2.4 Create `scripts/import-tournament.ts` — Node CLI (`tsx`); args: `--competition <id>` `--season <id>`; reads `TURSO_URL` + `TURSO_AUTH_TOKEN` from env; instantiates `FifaAdapter` + `DrizzleClient`; calls `importTournament`; prints `ImportResult` to stdout; exits non-zero on fatal error; never imported by Workers bundle.
- [ ] 2.5 Add `"import:tournament": "tsx scripts/import-tournament.ts"` to `package.json` scripts.
- [ ] 2.6 Delete `db/seeds/demo.sql` (replace with real import); add `// Note: use import:tournament 17 285023` comment in README or a `scripts/README.md` note.

---

## Phase 3 — Team Flags Component (PR 3)

- [ ] 3.1 Add `flag-icons` (or `circle-flags`) as a production dependency in `package.json`; confirm it ships static SVG files importable at build time with no external fetch at runtime.
- [ ] 3.2 **[RED]** Write `src/components/team-flag.test.tsx` — render `<TeamFlag code="AR" />` → contains an `<img>` or `<svg>` with non-empty `src`/content; render `<TeamFlag code={null} />` → renders placeholder element with a `data-testid="flag-placeholder"` attribute; render `<TeamFlag code="XX" />` → renders placeholder (unknown code); no test makes a network request.
- [ ] 3.3 **[GREEN]** Create `src/components/team-flag.tsx` — `TeamFlag({ code }: { code: string | null | undefined })` React component; loads bundled SVG from `flag-icons` keyed by lowercase ISO code; unknown or null code → renders `<span data-testid="flag-placeholder" aria-label="Unknown flag" …>`; no CDN URL, no `fetch`, no `<img src="http…">`; satisfy 3.2.

---

## Phase 4 — MatchDO → applyMatchResult + Live Results (PR 4)

- [ ] 4.1 **[RED]** Add test in `src/workers/match-do.test.ts` (workers pool) — assert that after a `POST /settle` with `status: "finished"`, `applyMatchResult` is invoked with correct args against a Turso-backed repo (use a test DB stub or miniflare binding); assert `prediction.points` updated in DB after settlement; assert `in_progress` status triggers bet-lock (no `points` written yet).
- [ ] 4.2 **[GREEN]** Modify `src/workers/match-do.ts` `_doSettle` — inject `Env.TURSO_URL` + `Env.TURSO_AUTH_TOKEN` bindings; construct `DrizzleMatchRepository` + `DrizzlePredictionRepository`; call `applyMatchResult(command, { matchRepository, predictionRepository }, clock)` on `status === "finished"`; on `status === "in_progress"` update only `match.status` (lock bets, do not settle points); DO storage idempotency guards remain as first line of defense; satisfy 4.1.
- [ ] 4.3 Update `src/worker-env.d.ts` to include `TURSO_URL: string` and `TURSO_AUTH_TOKEN: string` bindings on `Env`.
- [ ] 4.4 **[RED]** Write `src/adapters/result-source/fifa-live.test.ts` — assert that calling `FifaAdapter.getResult(matchId)` for a fixture with `IdMatch` resolves to a `MatchResult` with correct `status`, `homeScore`, `awayScore`, `source: "auto"`; assert API timeout (use `AbortController` spy) triggers a structured error, not a throw that escapes the port boundary.
- [ ] 4.5 **[GREEN/WIRE]** Add `GET /api/admin/ingest-results` backstage route (or extend existing admin route) — accepts `matchId`; calls `FifaAdapter.getResult(matchId)`; on success, delegates to `MATCH_DO` `/settle`; on error returns `{ ok: false, error }` without crashing; manual override route remains fully independent; satisfy live-results ingestion spec scenario "FIFA is primary source; manual is backstop".
- [ ] 4.6 **[RED]** Add workers-pool regression: confirm existing mutex single-flight tests still pass after 4.2 changes; run full `vitest --project workers` suite.

---

## Phase 5 — WC2026 Bootstrap & Cleanup

- [ ] 5.1 Run `npm run import:tournament -- --competition 17 --season 285023` against production Turso once; record output (warnings, upserted counts) in a `scripts/import-log-wc2026.txt` file (committed for audit).
- [ ] 5.2 Verify `team.code` coverage: query Turso for `SELECT id, name, code FROM team WHERE code IS NULL`; fill remaining gaps in `src/adapters/result-source/fifa-iso.ts` and re-run import (idempotent).
- [ ] 5.3 Confirm FIFA status codes 0, 1, 12 map correctly by querying one finished + one upcoming WC2026 match from live API (one-off manual verification); encode confirmed mappings into `mapStatus` table and add assertions to 1.8 test.
- [ ] 5.4 Remove any remaining demo-seed references from `src/` (grep for `demo.sql` / `demo seed`); update any CI seed scripts that referenced the old file.
- [ ] 5.5 Run full test suite (`vitest run`) + type check (`tsc --noEmit`); all green before merge.
