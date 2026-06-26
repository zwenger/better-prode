/**
 * scheduleAlarms — Workers-native admin server function.
 *
 * Schedules DO settlement alarms (kickoff + 150 min) for all matches in the
 * imported tournament structure. This is the binding-bearing call-site for
 * alarm scheduling — the Node CLI import script (scripts/import-tournament.ts)
 * has no DO bindings, so alarm scheduling must run from a Workers context.
 *
 * Design decision #6 (result-refresh design.md):
 *   importTournament(structure, db) stays env-free (unit-testable).
 *   scheduleImportAlarms(structure, env) is the separate, env-bearing thin caller.
 *   This admin fn fetches the current structure from FifaAdapter and calls it.
 *
 * Operational note (task 9.1):
 *   Run this admin fn ONCE post-deploy to backfill DO alarms for all
 *   already-imported matches. On-going, it can be re-run at any time;
 *   setAlarm() is idempotent (replaces, never stacks).
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";

// ---------------------------------------------------------------------------
// Admin guard helper (matches the pattern in -ingest-results.ts)
// ---------------------------------------------------------------------------

function isAdmin(userId: string): boolean {
  const adminIds = process.env["ADMIN_USER_IDS"] ?? "";
  return adminIds.split(",").map((id) => id.trim()).includes(userId);
}

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface ScheduleAlarmsInput {
  /**
   * FIFA competition ID (e.g. "17" for WC2026).
   * Used by FifaAdapter.fetchStructure to retrieve the match list.
   */
  competitionId: string;
  /**
   * FIFA season ID (e.g. "285023" for WC2026).
   */
  seasonId: string;
}

export interface ScheduleAlarmsOutput {
  success: boolean;
  scheduledCount: number;
  tournamentId: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Server function
// ---------------------------------------------------------------------------

export const scheduleAlarms = createServerFn({ method: "POST" })
  .validator((data: unknown): ScheduleAlarmsInput => {
    const raw = data as Record<string, unknown>;
    const competitionId = raw["competitionId"];
    const seasonId = raw["seasonId"];
    if (!competitionId || typeof competitionId !== "string") {
      throw Object.assign(new Error("competitionId is required"), { status: 400 });
    }
    if (!seasonId || typeof seasonId !== "string") {
      throw Object.assign(new Error("seasonId is required"), { status: 400 });
    }
    return { competitionId, seasonId };
  })
  .handler(async ({ data }): Promise<ScheduleAlarmsOutput> => {
    // Lazy imports keep Workers-specific bindings out of the module-level
    // import graph so this module can be imported in non-Workers contexts.
    const [{ env }, { auth }] = await Promise.all([
      import("cloudflare:workers"),
      import("#/infra/auth/auth"),
    ]);

    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      throw new Error("Unauthorized");
    }
    if (!isAdmin(session.user.id)) {
      throw new Error("Forbidden: admin only");
    }

    const { FifaAdapter } = await import("#/adapters/result-source/fifa");
    const { scheduleImportAlarms } = await import(
      "#/adapters/tournament-import/schedule-alarms"
    );

    const adapter = new FifaAdapter();
    const structure = await adapter.fetchStructure(data.competitionId, data.seasonId);

    await scheduleImportAlarms(structure, env);

    return {
      success: true,
      scheduledCount: structure.matches.length,
      tournamentId: structure.tournamentId,
    };
  });
