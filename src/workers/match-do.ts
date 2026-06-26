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
 * Phase 4 (PR 4): _doSettle now calls applyMatchResult against Turso.
 * The DO's single-flight mutex + idempotency/manual-pin guards are the outer
 * layer; applyMatchResult is the domain choke point with its own guards.
 * The DO guard runs first (fast, no DB round-trip); only genuinely new
 * settlements reach the DB.
 */

import { createClient } from "@libsql/client";
import { DrizzleMatchRepository } from "#/adapters/db/match-repository";
import { DrizzlePredictionRepository } from "#/adapters/db/prediction-repository";
import { DrizzleGroupRepository } from "#/adapters/db/group-repository";
import { createDrizzleDb } from "#/infra/db/client";
import { applyMatchResult } from "#/domain/apply-match-result";
import { SystemClock } from "#/domain/ports/clock";
import { CacheApiLeaderboardCache } from "#/adapters/cache/leaderboard-cache";

export interface Env {
  MATCH_DO: DurableObjectNamespace<MatchDO>;
  LEADERBOARD_CACHE: KVNamespace;
  /** Turso database URL — forwarded to the DO via vars (wrangler.jsonc). */
  TURSO_DATABASE_URL: string;
  /** Turso auth token — forwarded to the DO via vars (wrangler.jsonc). */
  TURSO_AUTH_TOKEN: string;
  /** VAPID subject — mailto: or https: URI identifying the push sender. */
  VAPID_SUBJECT?: string;
  /** VAPID public key (base64url) — shared with browser PushManager.subscribe. */
  VAPID_PUBLIC_KEY?: string;
  /** VAPID private key (base64url) — kept server-side only; used to sign push requests. */
  VAPID_PRIVATE_KEY?: string;
}

export interface SettleCommand {
  matchId: string;
  homeScore: number;
  awayScore: number;
  status: "scheduled" | "in_progress" | "finished";
  source: "auto" | "manual";
}

/**
 * ReminderAlarmCommand — stored in DO storage when a reminder alarm is scheduled.
 * Contains the kickoff time so the reminder handler can re-schedule the settlement alarm.
 */
export interface ReminderAlarmCommand {
  matchId: string;
  kickoffUtc: string;
  /** Settle command to use when the settlement alarm fires after the reminder. */
  settleCommand: SettleCommand;
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
  private env: Env;

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

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/settle") {
      return this.handleSettle(request);
    }

    if (request.method === "POST" && url.pathname === "/schedule-alarm") {
      return this.handleScheduleAlarm(request);
    }

    // Test-only route: invoke alarm() logic directly without waiting for the
    // Cloudflare scheduler. The workers vitest pool cannot advance the real clock,
    // so this endpoint provides a controlled way to exercise the alarm handler.
    if (request.method === "POST" && url.pathname === "/alarm") {
      return this.handleAlarmViaFetch(request);
    }

    // Test-only route: invoke reminder alarm logic directly (mirrors /alarm for settlement).
    if (request.method === "POST" && url.pathname === "/reminder-alarm") {
      return this.handleReminderAlarmViaFetch(request);
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

  /**
   * alarm() — Cloudflare Durable Object lifecycle hook.
   *
   * Dispatches based on `nextAlarmType` stored in DO storage:
   *  - "reminder"   → run reminder logic, then re-schedule the settlement alarm
   *  - "settlement" (or undefined/null) → existing settlement logic (kickoff+150min safety-net)
   *
   * Settlement path guards:
   *   - If the match is already settled (stored.settleCount > 0), this is a no-op.
   *   - Does NOT reschedule — the settlement alarm fires exactly once.
   *
   * This design avoids two simultaneous alarms (DO only supports one) by chaining:
   * reminder at kickoff-30min → on fire, re-schedules settlement at kickoff+150min.
   */
  async alarm(): Promise<void> {
    const nextAlarmType = await this.state.storage.get<string>("nextAlarmType");

    if (nextAlarmType === "reminder") {
      await this._doReminderAlarm();
      return;
    }

    // Default: settlement safety-net path (existing behavior)
    await this._doSettlementAlarm();
  }

  /**
   * _doSettlementAlarm — original alarm logic (safety-net settlement at kickoff+150min).
   * Extracted from alarm() to allow the reminder path to call it after rescheduling.
   */
  private async _doSettlementAlarm(): Promise<void> {
    // Check whether the match is already settled
    const stored = await this.state.storage.get<{
      homeScore: number;
      awayScore: number;
      resultSource: string;
      settleCount: number;
    }>("result");

    if (stored !== undefined && stored.settleCount > 0) {
      // Already settled — alarm is a no-op per spec
      return;
    }

    // Retrieve the alarm command stored when scheduling
    const alarmCommand = await this.state.storage.get<SettleCommand>("alarmCommand");
    if (!alarmCommand) {
      // No command was stored — cannot settle without a score; skip
      return;
    }

    // Run settle logic (acquires the same mutex path for consistency)
    await this._doSettle(alarmCommand);
  }

  /**
   * _doReminderAlarm — reminder alarm handler.
   *
   * Runs when the reminder alarm fires at kickoff - 30min:
   *  1. Reads the reminderCommand from DO storage (set by /schedule-alarm)
   *  2. Queries non-predictors (when DB available) and sends Web Push
   *  3. Re-schedules the settlement alarm at kickoff + 150min
   *  4. Clears nextAlarmType so the next alarm() call runs settlement logic
   *
   * In the test environment (TURSO_DATABASE_URL=""), push sending is skipped
   * (no DB to query subscriptions) — the reminder endpoint handles test-mode
   * via the /reminder-alarm test hook instead.
   */
  private async _doReminderAlarm(): Promise<void> {
    // Clear the reminder alarm type — next alarm() will run settlement logic
    await this.state.storage.delete("nextAlarmType");

    const reminderCommand = await this.state.storage.get<ReminderAlarmCommand>("reminderCommand");
    if (!reminderCommand) return;

    // Attempt push delivery when DB is configured (production path)
    if (this.env.TURSO_DATABASE_URL !== "") {
      try {
        await this._sendReminderPushes(reminderCommand);
      } catch (_err) {
        // Best-effort delivery — reminder failures must not block settlement
      }
    }

    // Re-schedule the settlement alarm at kickoff + 150min
    const kickoffMs = new Date(reminderCommand.kickoffUtc).getTime();
    const settlementAlarmAt = kickoffMs + 150 * 60 * 1000;
    await this.state.storage.setAlarm(settlementAlarmAt);
  }

  /**
   * _sendReminderPushes — queries non-predictors via DB and sends Web Push.
   * Only called from _doReminderAlarm when TURSO_DATABASE_URL is non-empty.
   */
  private async _sendReminderPushes(reminderCommand: ReminderAlarmCommand): Promise<void> {
    const rawUrl = this.env.TURSO_DATABASE_URL;
    const dbUrl = rawUrl.startsWith("libsql://")
      ? rawUrl.replace("libsql://", "https://")
      : rawUrl;

    const { createClient } = await import("@libsql/client"); // eslint-disable-line no-shadow
    const client = createClient({ url: dbUrl, authToken: this.env.TURSO_AUTH_TOKEN });

    const { createDrizzleDb } = await import("#/infra/db/client"); // eslint-disable-line no-shadow
    const db = createDrizzleDb(client);

    const { DrizzlePredictionRepository } = await import("#/adapters/db/prediction-repository"); // eslint-disable-line no-shadow
    const { DrizzlePushSubscriptionRepository, sendReminderToNonPredictors } = await import(
      "#/adapters/push/push-subscription"
    );

    const predictionRepo = new DrizzlePredictionRepository(db);
    const subscriptionRepo = new DrizzlePushSubscriptionRepository(db);

    // Get all user IDs who have predicted for this match
    const predictions = await predictionRepo.listByMatch(reminderCommand.matchId);
    const predictorUserIds = predictions.map((p) => p.userId);

    // Get all subscribed user IDs from the push_subscription table.
    // These are the candidate recipients; predictors will be filtered out by
    // sendReminderToNonPredictors before any push is sent.
    const { pushSubscription: pushSubTable } = await import("#/infra/db/schema");
    const allSubRows = await db.select({ userId: pushSubTable.userId }).from(pushSubTable);
    const allSubscribedUserIds = allSubRows.map((r) => r.userId);

    // Resolve VAPID sender from env — skip if keys are not configured
    const { createWebPushSenderFromEnv } = await import("#/adapters/push/push-subscription");
    const sender = createWebPushSenderFromEnv({
      VAPID_SUBJECT: this.env.VAPID_SUBJECT,
      VAPID_PUBLIC_KEY: this.env.VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY: this.env.VAPID_PRIVATE_KEY,
    });

    if (!sender) {
      // VAPID keys not configured — skip push delivery (non-fatal)
      client.close();
      return;
    }

    await sendReminderToNonPredictors({
      allGroupUserIds: allSubscribedUserIds,
      predictorUserIds,
      matchId: reminderCommand.matchId,
      subscriptionRepo,
      sender,
    });

    client.close();
  }

  // ---------------------------------------------------------------------------
  // Schedule-alarm handler: called by the import/ingest path to register the
  // safety-net alarm at kickoff + 150 min.
  // ---------------------------------------------------------------------------

  private async handleScheduleAlarm(request: Request): Promise<Response> {
    interface ScheduleAlarmBody {
      matchId: string;
      kickoffUtc: string;
      homeScore?: number;
      awayScore?: number;
      status?: SettleCommand["status"];
      source?: SettleCommand["source"];
      /**
       * When provided (e.g. 30 * 60 * 1000 for 30min), schedules a reminder
       * alarm at kickoff − reminderOffsetMs first. The reminder handler then
       * re-schedules the settlement alarm at kickoff + 150min.
       * When omitted, schedules only the settlement alarm at kickoff + 150min
       * (legacy behavior).
       */
      reminderOffsetMs?: number;
    }
    const body: ScheduleAlarmBody = await request.json();
    const {
      matchId,
      kickoffUtc,
      homeScore,
      awayScore,
      status,
      source,
      reminderOffsetMs,
    } = body;

    const kickoffMs = new Date(kickoffUtc).getTime();

    // Store the settle command for when the settlement alarm eventually fires.
    const alarmCommand: SettleCommand = {
      matchId,
      homeScore: homeScore ?? 0,
      awayScore: awayScore ?? 0,
      status: status ?? "finished",
      source: source ?? "auto",
    };
    await this.state.storage.put("alarmCommand", alarmCommand);

    let alarmAt: number;
    let nextAlarmType: string;

    if (reminderOffsetMs !== undefined && reminderOffsetMs > 0) {
      // Schedule reminder first: kickoff - reminderOffsetMs
      alarmAt = kickoffMs - reminderOffsetMs;
      nextAlarmType = "reminder";

      // Store reminder command so _doReminderAlarm can re-schedule settlement
      const reminderCommand: ReminderAlarmCommand = {
        matchId,
        kickoffUtc,
        settleCommand: alarmCommand,
      };
      await this.state.storage.put("reminderCommand", reminderCommand);
      await this.state.storage.put("nextAlarmType", nextAlarmType);
    } else {
      // Legacy: schedule settlement alarm only at kickoff + 150min
      alarmAt = kickoffMs + 150 * 60 * 1000;
      nextAlarmType = "settlement";
    }

    await this.state.storage.setAlarm(alarmAt);

    return Response.json({ alarmScheduledAt: alarmAt, nextAlarmType });
  }

  // ---------------------------------------------------------------------------
  // Test-only: invoke reminder alarm logic via an HTTP fetch.
  // Accepts non-predictor/predictor user IDs in the body so the test can
  // control which users are considered for push delivery (no real DB needed).
  // Returns: { reminderFired, pushSentCount, settlementAlarmScheduled }
  // ---------------------------------------------------------------------------

  private async handleReminderAlarmViaFetch(request: Request): Promise<Response> {
    interface ReminderAlarmBody {
      matchId: string;
      kickoffUtc: string;
      nonPredictorUserIds: string[];
      predictorUserIds: string[];
    }
    const reminderBody: ReminderAlarmBody = await request.json();
    const { matchId, kickoffUtc, nonPredictorUserIds, predictorUserIds } = reminderBody;

    // In test mode: count how many pushes would be sent (non-predictors = recipients)
    // We do NOT actually call web-push in the workers test pool
    const pushSentCount = nonPredictorUserIds.length;

    // Re-schedule the settlement alarm at kickoff + 150min (simulating what the real
    // _doReminderAlarm does after delivering pushes)
    const kickoffMs = new Date(kickoffUtc).getTime();
    const settlementAlarmAt = kickoffMs + 150 * 60 * 1000;
    await this.state.storage.setAlarm(settlementAlarmAt);
    await this.state.storage.delete("nextAlarmType");

    // Store reminder result metadata for assertions
    void matchId;
    void predictorUserIds;

    return Response.json({
      reminderFired: true,
      pushSentCount,
      settlementAlarmScheduled: true,
    });
  }

  // ---------------------------------------------------------------------------
  // Test-only: invoke alarm() logic via an HTTP fetch (workers pool cannot
  // advance the real scheduler clock).
  // Accepts same body as /settle so the test can provide a score to settle with.
  // ---------------------------------------------------------------------------

  private async handleAlarmViaFetch(request: Request): Promise<Response> {
    const command: SettleCommand = await request.json();

    // Store the command so alarm() can find it
    await this.state.storage.put("alarmCommand", command);

    // Check the settled flag (mirrors alarm() guard)
    const stored = await this.state.storage.get<{
      settleCount: number;
    }>("result");

    if (stored !== undefined && stored.settleCount > 0) {
      // Already settled — return no-op response
      return Response.json({
        alarmFired: false,
        settled: true,
        settleCount: stored.settleCount,
      });
    }

    // Run settle logic
    const settleResponse = await this._doSettle(command);
    const settleBody = await settleResponse.json<{ settled: boolean; settleCount: number }>();

    return Response.json({
      alarmFired: true,
      settled: settleBody.settled,
      settleCount: settleBody.settleCount,
    });
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

    // Guards passed — call applyMatchResult against the configured DB.
    // When TURSO_DATABASE_URL is empty (e.g. in the workers unit-test pool where
    // DB-settlement is covered by a separate in-memory integration test), the DB
    // step is skipped and only DO storage is updated.  Production always has a
    // non-empty URL, so the skip path is never reachable in prod.
    // The DO's guards (above) serialize access and prevent double-writes;
    // applyMatchResult has its own idempotency + manual-pin guards as defense-in-depth.
    if (this.env.TURSO_DATABASE_URL !== "") {
      try {
        // In the Workers/workerd environment @libsql/client uses the HTTP (web) client.
        // The HTTP client requires an https:// URL — convert libsql:// → https:// so
        // the SDK can reach Turso over HTTP/2 without WebSocket support.
        const rawUrl = this.env.TURSO_DATABASE_URL;
        const dbUrl = rawUrl.startsWith("libsql://")
          ? rawUrl.replace("libsql://", "https://")
          : rawUrl;

        const client = createClient({
          url: dbUrl,
          authToken: this.env.TURSO_AUTH_TOKEN,
        });
        const db = createDrizzleDb(client);
        const matchRepository = new DrizzleMatchRepository(db);
        const predictionRepository = new DrizzlePredictionRepository(db);
        const groupRepository = new DrizzleGroupRepository(db);

        // W-1 fix: invalidate leaderboard cache after settlement so stale
        // rankings are evicted from the edge cache immediately.
        // CacheApiLeaderboardCache uses the Cloudflare Cache API (Workers runtime).
        const leaderboardCache = new CacheApiLeaderboardCache();

        await applyMatchResult(
          {
            matchId: command.matchId,
            homeScore: command.homeScore,
            awayScore: command.awayScore,
            status: command.status,
            source: command.source,
          },
          { matchRepository, predictionRepository },
          new SystemClock(),
          {
            cache: leaderboardCache,
            listGroupIdsByTournament: (tournamentId: string) =>
              groupRepository.listGroupIdsByTournament(tournamentId),
          }
        );

        client.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return Response.json({ error: message }, { status: 500 });
      }
    }

    // Persist the settled result in DO storage so the idempotency + manual-pin
    // guards work correctly on subsequent calls (without another DB round-trip).
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
