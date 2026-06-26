/**
 * scheduleImportAlarms — thin caller that schedules DO settlement alarms
 * for all matches in a TournamentStructure.
 *
 * Design decision #6 (result-refresh design.md):
 *   importTournament(structure, db) stays env-free (unit-testable, no DO bindings).
 *   This thin caller handles the binding-bearing alarm scheduling separately.
 *   Idempotency: DO.setAlarm() REPLACES the single stored alarm — re-importing
 *   the same match re-sets the same deadline without stacking additional alarms.
 *
 * No reminderOffsetMs is sent: settlement-only alarm at kickoff + 150 min.
 * The DO handleScheduleAlarm() uses the kickoff from the payload to compute
 * the alarm time as kickoff + 150 * 60 * 1000.
 */

import type { TournamentStructure } from "#/domain/ports/tournament-source";

/**
 * Schedule a settlement DO alarm for every match in the structure.
 *
 * @param structure Parsed tournament structure (from FifaAdapter.fetchStructure or DB).
 * @param env       Worker env object with MATCH_DO binding.
 */
export async function scheduleImportAlarms(
  structure: TournamentStructure,
  env: { MATCH_DO: DurableObjectNamespace }
): Promise<void> {
  await Promise.all(
    structure.matches.map(async (m) => {
      const doId = env.MATCH_DO.idFromName(m.id);
      const stub = env.MATCH_DO.get(doId);
      await stub.fetch("http://do/schedule-alarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId: m.id,
          kickoffUtc: m.kickoffUtc,
          // No reminderOffsetMs — settlement-only alarm at kickoff+150min.
        }),
      });
    })
  );
}
