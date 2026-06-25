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
  // Required by Rpc.DurableObjectBranded (cloudflare workers-types)
  declare [Rpc.__DURABLE_OBJECT_BRAND]: never;

  private state: DurableObjectState;

  /**
   * W1 fix: in-memory Promise chain serializes all handleSettle calls.
   *
   * Cloudflare DOs are single-threaded, but async handlers can interleave
   * at every `await` point. Two requests arriving simultaneously both start
   * their fetch() handler; at `await request.json()`, the event loop can
   * switch to the second handler. By the time both reach the storage read,
   * both see `stored = undefined` and both write settleCount=1 — double-apply.
   *
   * blockConcurrencyWhile() queues NEW requests but does not help when both
   * handlers have already started (past their first await).
   *
   * Solution: a Promise-chain mutex. Each call to handleSettle() chains onto
   * the previous one via _settleMutex. Requests are therefore serialized in
   * the order they acquire the mutex, regardless of how many concurrent fetches
   * were in-flight before they called chain().
   */
  private _settleMutex: Promise<void> = Promise.resolve();

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
    // Parse the request body BEFORE acquiring the mutex (body can only be read once
    // and the stream must be consumed before the handler returns).
    const command: SettleCommand = await request.json();

    // Acquire the mutex: chain this settle onto the previous one.
    // Any subsequent call that arrives while we are executing will queue behind us.
    let releaseResolve!: () => void;
    const holdLock = new Promise<void>((resolve) => { releaseResolve = resolve; });
    const waitForPrev = this._settleMutex;
    this._settleMutex = holdLock;

    // Wait for the previous operation to finish before proceeding.
    await waitForPrev;

    try {
      return await this._doSettle(command);
    } finally {
      releaseResolve();
    }
  }

  private async _doSettle(command: SettleCommand): Promise<Response> {
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

    // Single-flight guard: once ANY auto result is stored, subsequent auto calls
    // with different scores are no-ops (first-writer-wins for auto).
    // This prevents double-apply under concurrent settlement attempts.
    // Only a manual override can replace an existing auto result.
    if (stored !== undefined && stored.resultSource === "auto" && command.source === "auto") {
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
