# scripts/

Backstage CLI scripts for database management and data ingestion.

## import-tournament.ts

Seeds or refreshes the tournament structure (teams, matches, groups) from the
FIFA API into Turso. Idempotent — safe to re-run; will not duplicate rows.

**Does NOT overwrite settled match results.** Only structural fields (kickoff,
group, stage) are updated on re-run.

### Usage

```sh
TURSO_DATABASE_URL=libsql://...turso.io TURSO_AUTH_TOKEN=<token> \
  npm run import:tournament -- --competition 17 --season 285023
```

For WC2026, use:
- `--competition 17`
- `--season 285023`

### Output

Prints an `ImportResult` JSON to stdout:

```json
{
  "upsertedTeams": 48,
  "upsertedMatches": 104,
  "warnings": []
}
```

Any teams without an ISO code mapping are listed in `warnings`. Run
`src/adapters/result-source/fifa-iso.ts` to add missing mappings, then
re-run the import to populate `team.code`.

## db-seed.js

Stub — no longer needed for production data. Use `import:tournament` instead.

## e2e-server.sh

Starts the dev server for Playwright E2E tests. The E2E test database is
seeded from `db/seeds/e2e-fixture.sql` (independent of the import script).
