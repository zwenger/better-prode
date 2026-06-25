/**
 * POST /api/admin/apply-result
 *
 * Admin endpoint to manually apply a match result.
 * - Admin-only guard (checks ADMIN_USER_IDS env var)
 * - Validates goal inputs (non-negative integers) — HTTP 400 on invalid
 * - Sets source=manual, pins result (auto cannot overwrite)
 * - C2 fix: routes ALL settlement through the per-match MATCH_DO so there
 *   is a single serialized path (same as the automatic trigger).
 *   Direct applyMatchResult calls are NOT allowed here.
 *
 * Spec (result-triggering, match-results): manual source pins;
 * admin is the backstop when auto polling is unavailable.
 * Design (C2): all settlement MUST go through MATCH_DO for single-flight.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { env } from "cloudflare:workers";
import { auth } from "#/infra/auth/auth";
import { validateGoals } from "#/domain/validate-goals";
import type { SettleCommand } from "#/workers/match-do";

export interface ApplyResultInput {
  matchId: string;
  homeScore: number;
  awayScore: number;
  status?: "finished" | "in_progress";
}

export interface ApplyResultOutput {
  success: boolean;
  settled?: boolean;
  settleCount?: number;
  error?: string;
}

/**
 * Simple admin check — in MVP, any user listed in ADMIN_USER_IDS env var.
 * This should be replaced with a proper role system in a future PR.
 */
function isAdmin(userId: string): boolean {
  const adminIds = process.env["ADMIN_USER_IDS"] ?? "";
  return adminIds.split(",").map((id) => id.trim()).includes(userId);
}

export const applyResult = createServerFn({ method: "POST" })
  .validator((data: unknown): ApplyResultInput => {
    // W2: reject invalid goal values with HTTP 400 before touching the DO.
    const input = data as ApplyResultInput;
    const goalsError = validateGoals(input?.homeScore, input?.awayScore);
    if (goalsError) {
      throw Object.assign(new Error(goalsError), { status: 400 });
    }
    return input;
  })
  .handler(async ({ data }): Promise<ApplyResultOutput> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      throw new Error("Unauthorized");
    }
    if (!isAdmin(session.user.id)) {
      throw new Error("Forbidden: admin only");
    }

    // C2 fix: route through MATCH_DO for single-flight serialization.
    // The DO handles idempotency and the manual-pin guard internally.
    const doId = env.MATCH_DO.idFromName(data.matchId);
    const stub = env.MATCH_DO.get(doId);

    const command: SettleCommand = {
      matchId: data.matchId,
      homeScore: data.homeScore,
      awayScore: data.awayScore,
      status: data.status ?? "finished",
      source: "manual",
    };

    const response = await stub.fetch("http://do/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MATCH_DO settlement failed: ${response.status} — ${text}`);
    }

    const result = await response.json<{ settled: boolean; settleCount: number }>();

    return { success: true, settled: result.settled, settleCount: result.settleCount };
  });
