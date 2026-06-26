/**
 * Raw HTTP handler for POST /api/predictions/submit.
 *
 * Exposes prediction submit as a plain HTTP endpoint so Playwright E2E tests
 * can POST to it directly without TanStack's server-fn RPC path discovery.
 *
 * The server-fn in -submit.ts remains the canonical path used by the
 * application UI (via submitPrediction server fn). This handler uses the
 * same underlying submitPredictionCore domain logic.
 *
 * Registered in src/server.ts fetch interceptor.
 */

import { auth } from "#/infra/auth/auth";
import { getDb } from "#/infra/db/client";
import { SystemClock } from "#/domain/ports/clock";
import { validateGoals } from "#/domain/validate-goals";
import { DrizzleMatchRepository } from "#/adapters/db/match-repository";
import { DrizzlePredictionRepository } from "#/adapters/db/prediction-repository";
import { submitPredictionCore } from "#/domain/submit-prediction";

export async function handleSubmitPrediction(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const raw: unknown = await request.json();
    body = raw as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const goalsError = validateGoals(body["homeGoals"], body["awayGoals"]);
  if (goalsError) {
    return Response.json({ error: goalsError }, { status: 400 });
  }

  const db = getDb();

  try {
    const result = await submitPredictionCore({
      userId: session.user.id,
      input: {
        matchId: String(body["matchId"] ?? ""),
        homeGoals: Number(body["homeGoals"]),
        awayGoals: Number(body["awayGoals"]),
      },
      matchRepo: new DrizzleMatchRepository(db),
      predRepo: new DrizzlePredictionRepository(db),
      clock: new SystemClock(),
    });

    return Response.json(result, { status: 200 });
  } catch (err: unknown) {
    const errObj = err as { message?: string; status?: number };
    if (errObj.message === "match_locked") {
      return Response.json({ error: "match_locked", reason: "match_locked" }, { status: 422 });
    }
    const status = typeof errObj.status === "number" ? errObj.status : 500;
    return Response.json({ error: errObj.message ?? "Internal error" }, { status });
  }
}
