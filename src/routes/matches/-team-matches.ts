/**
 * Server function — returns all matches for a given team code.
 *
 * Auth NOT required: match data is public.
 */

import { createServerFn } from "@tanstack/react-start";
import { getDb } from "#/infra/db/client";
import { DrizzleMatchRepository } from "#/adapters/db/match-repository";
import type { TeamMatchRow } from "#/adapters/db/match-repository";

interface TeamMatchesInput {
  teamCode: string;
}

export const getTeamMatchesFn = createServerFn({ method: "GET", strict: false })
  .validator((data: unknown): TeamMatchesInput => data as TeamMatchesInput)
  .handler(async ({ data }): Promise<TeamMatchRow[]> => {
    const db = getDb();
    return new DrizzleMatchRepository(db).getTeamMatches(data.teamCode);
  });
