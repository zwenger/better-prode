#!/usr/bin/env tsx
/**
 * import-tournament — backstage CLI for seeding/refreshing tournament structure.
 *
 * Usage:
 *   npm run import:tournament -- --competition 17 --season 285023
 *
 * Environment variables required:
 *   TURSO_DATABASE_URL   — libSQL URL (e.g. libsql://....turso.io)
 *   TURSO_AUTH_TOKEN     — auth token for Turso (optional for file: URLs)
 *
 * Design decision #5 (design.md):
 *   Runner is a Node CLI (tsx), not a TanStack server function or admin route.
 *   Rationale: one-time / CI operation; no request context; runs with Turso
 *   creds outside the Workers bundle.
 *
 * This script is NEVER imported by the Workers bundle.
 */

import { createClient } from "@libsql/client";
import { createDrizzleDb } from "#/infra/db/client";
import { FifaAdapter } from "#/adapters/result-source/fifa";
import { importTournament } from "#/adapters/tournament-import/import";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { competition: string; season: string } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg && arg.startsWith("--") && argv[i + 1] && !argv[i + 1]!.startsWith("--")) {
      args[arg.slice(2)] = argv[i + 1]!;
      i++;
    }
  }

  const competition = args["competition"];
  const season = args["season"];

  if (!competition || !season) {
    console.error(
      "Usage: tsx scripts/import-tournament.ts --competition <id> --season <id>"
    );
    console.error("Example: tsx scripts/import-tournament.ts --competition 17 --season 285023");
    process.exit(1);
  }

  return { competition, season };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { competition, season } = parseArgs(process.argv.slice(2));

  const tursoUrl = process.env["TURSO_DATABASE_URL"];
  const tursoToken = process.env["TURSO_AUTH_TOKEN"];

  if (!tursoUrl) {
    console.error("Error: TURSO_DATABASE_URL environment variable is required.");
    process.exit(1);
  }

  console.log(`[import-tournament] Fetching structure: competition=${competition} season=${season}`);

  // Build adapter and DB client
  const adapter = new FifaAdapter();
  const client = createClient({ url: tursoUrl, authToken: tursoToken });
  const db = createDrizzleDb(client);

  // Fetch structure from FIFA
  let structure;
  try {
    structure = await adapter.fetchStructure(competition, season);
  } catch (err) {
    console.error(
      `[import-tournament] Fatal: failed to fetch structure from FIFA API.`,
      err instanceof Error ? err.message : String(err)
    );
    process.exit(1);
  }

  console.log(
    `[import-tournament] Fetched: "${structure.name}" — ${structure.teams.length} teams, ${structure.matches.length} matches`
  );

  // Run import
  let result;
  try {
    result = await importTournament(structure, db);
  } catch (err) {
    console.error(
      `[import-tournament] Fatal: DB import failed.`,
      err instanceof Error ? err.message : String(err)
    );
    process.exit(1);
  }

  // Report
  console.log("[import-tournament] Import complete.");
  console.log(JSON.stringify(result, null, 2));

  if (result.warnings.length > 0) {
    console.warn(`[import-tournament] ${result.warnings.length} warning(s):`);
    for (const w of result.warnings) {
      console.warn(`  - ${w}`);
    }
  }

  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("[import-tournament] Unexpected error:", err);
  process.exit(1);
});
