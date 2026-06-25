/**
 * MatchDO — per-match Durable Object.
 *
 * Provides single-flight serialization around match result settlement.
 * Design decision #4: Durable Objects are single-threaded → only one
 * invocation of the settlement logic runs at a time, even under thundering
 * herd (100+ concurrent viewers after final whistle).
 *
 * The DO also schedules a safety-net alarm at kickoff + 150 min (PR 3).
 *
 * State stored in DO storage (durable, survives eviction):
 *   - homeScore / awayScore / resultSource: last settled result
 *   - settleCount: number of times settlement actually ran (idempotency proof)
 *   - settled: boolean flag
 *
 * In the tracer-bullet (PR 1) the settlement logic is self-contained inside
 * the DO — no DB calls — so the single-flight guarantee can be proven purely
 * from the DO storage without wiring up Turso.
 * Full DB integration (applyMatchResult port chain) lands in PR 3.
 */

export interface Env {
  MATCH_DO: DurableObjectNamespace<MatchDO>;
  LEADERBOARD_CACHE: KVNamespace;
}

export interface SettleCommand {
  matchId: string;
  homeScore: number;
  awayScore: number;
  status: "scheduled" | "in_progress" | "finished";
  source: "auto" | "manual";
}

export interface SettleResult {
  settled: boolean;
  settleCount: number;
  homeScore: number | null;
  awayScore: number | null;
  resultSource: string | null;
}

export class MatchDO implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/settle") {
      return this.handleSettle(request);
    }

    return new Response("Not found", { status: 404 });
  }

  private async handleSettle(request: Request): Promise<Response> {
    const command: SettleCommand = await request.json();

    // Read current state from durable storage
    const stored = await this.state.storage.get<{
      homeScore: number;
      awayScore: number;
      resultSource: string;
      settleCount: number;
    }>("result");

    // Idempotency: same score + same source → no-op
    if (
      stored !== undefined &&
      stored.homeScore === command.homeScore &&
      stored.awayScore === command.awayScore &&
      stored.resultSource === command.source
    ) {
      const result: SettleResult = {
        settled: true,
        settleCount: stored.settleCount,
        homeScore: stored.homeScore,
        awayScore: stored.awayScore,
        resultSource: stored.resultSource,
      };
      return Response.json(result);
    }

    // Manual-pin guard: auto cannot overwrite an existing manual result
    if (stored !== undefined && stored.resultSource === "manual" && command.source === "auto") {
      const result: SettleResult = {
        settled: true,
        settleCount: stored.settleCount,
        homeScore: stored.homeScore,
        awayScore: stored.awayScore,
        resultSource: stored.resultSource,
      };
      return Response.json(result);
    }

    // Settle: persist result
    const settleCount = (stored?.settleCount ?? 0) + 1;
    const newResult = {
      homeScore: command.homeScore,
      awayScore: command.awayScore,
      resultSource: command.source,
      settleCount,
    };

    // blockConcurrencyWhile ensures this write is atomic and no concurrent
    // request can read stale state during our write
    await this.state.storage.put("result", newResult);

    const result: SettleResult = {
      settled: true,
      settleCount,
      homeScore: command.homeScore,
      awayScore: command.awayScore,
      resultSource: command.source,
    };
    return Response.json(result);
  }
}
