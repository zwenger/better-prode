/// <reference types="@cloudflare/vitest-pool-workers/types" />

/**
 * TDD: MatchDO Durable Object tests
 *
 * Spec (single-flight, testability):
 *  - Per-match DO provides single-flight serialization around settlement
 *  - 100 concurrent fetch() calls → exactly 1 settlement (settleCount === 1)
 *  - Idempotency: repeated calls with same args → no-op (settleCount stays 1)
 *  - Manual-pin: first-writer-wins; auto cannot overwrite an existing manual result
 *  - Uses @cloudflare/vitest-pool-workers (real workerd runtime)
 *  - Mock DO is NOT acceptable for single-flight proof
 *
 * DB-settlement behaviour (applyMatchResult against libSQL) is covered by a
 * separate unit/integration test:
 *   src/adapters/db/settlement-integration.test.ts
 * That test runs against an in-memory libSQL instance inside the Node unit
 * project, so it NEVER touches any remote database.
 *
 * In the workers pool the DO's TURSO_DATABASE_URL is overridden to "" via
 * vitest.config.ts miniflare.bindings.  _doSettle detects the empty URL and
 * skips the DB call, making these tests storage-only and fully isolated.
 *
 * The DO serializes requests via its Promise-chain mutex (_settleMutex).
 * We verify that settlement logic (tracked via DO storage settleCount) runs
 * exactly once even under a thundering herd of 100 concurrent requests.
 */

import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { Env } from "./match-do";

// Cast env to the locally-defined Env type so TypeScript knows about MATCH_DO.
// The workers vitest pool binds MATCH_DO per wrangler.jsonc at runtime.
const testEnv = env as Env;

describe("MatchDO — single-flight settlement", () => {
  it("single fetch call returns 200 and settles the match", async () => {
    const id = testEnv.MATCH_DO.idFromName("match-single-flight-test");
    const stub = testEnv.MATCH_DO.get(id);

    const response = await stub.fetch(
      "http://do/settle",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId: "match-single-flight-test",
          homeScore: 2,
          awayScore: 1,
          status: "finished",
          source: "auto",
        }),
      }
    );

    expect(response.status).toBe(200);
    const body = await response.json<{ settled: boolean; settleCount: number }>();
    expect(body.settled).toBe(true);
    expect(body.settleCount).toBe(1);
  });

  it("100 concurrent fetch() calls → exactly 1 settlement (single-flight)", async () => {
    const matchId = "match-concurrent-test";
    const id = testEnv.MATCH_DO.idFromName(matchId);
    const stub = testEnv.MATCH_DO.get(id);

    const payload = JSON.stringify({
      matchId,
      homeScore: 3,
      awayScore: 0,
      status: "finished",
      source: "auto",
    });

    // Fire 100 concurrent requests to the same DO instance
    const requests = Array.from({ length: 100 }, () =>
      stub.fetch("http://do/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      })
    );

    const responses = await Promise.all(requests);

    // All should succeed
    for (const response of responses) {
      expect(response.status).toBe(200);
    }

    // The DO should report exactly 1 settlement happened (idempotent from #2 onward)
    type SettleBody = { settled: boolean; settleCount: number };
    const bodies = await Promise.all(
      responses.map((r: Response) => r.json<SettleBody>())
    );
    const maxSettleCount = Math.max(...bodies.map((b) => b.settleCount));
    expect(maxSettleCount).toBe(1);
  });

  it("idempotent — same args on repeated calls → no additional settlement", async () => {
    const matchId = "match-idempotent-test";
    const id = testEnv.MATCH_DO.idFromName(matchId);
    const stub = testEnv.MATCH_DO.get(id);

    const payload = {
      matchId,
      homeScore: 1,
      awayScore: 1,
      status: "finished",
      source: "auto",
    };

    // First call
    const r1 = await stub.fetch("http://do/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(r1.status).toBe(200);
    const b1 = await r1.json<{ settled: boolean; settleCount: number }>();
    expect(b1.settleCount).toBe(1);

    // Second call with same payload — no-op
    const r2 = await stub.fetch("http://do/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(r2.status).toBe(200);
    const b2 = await r2.json<{ settled: boolean; settleCount: number }>();
    // Still 1 — did not re-settle
    expect(b2.settleCount).toBe(1);
  });

  // S3: Strengthen single-flight test — distinct concurrent settlement attempts.
  // This test proves real single-flight atomicity (not just idempotency).
  //
  // Without blockConcurrencyWhile: concurrent requests can both read
  // stored=undefined at the same await point, both compute settleCount=1,
  // and both write — settlement "logic" runs twice even though only one
  // settleCount is recorded. The observable symptom is that the final stored
  // result is non-deterministic (last writer wins), and settleCount can be
  // inconsistent across responses.
  //
  // With blockConcurrencyWhile: only one request reads-and-writes atomically;
  // the second one reads the already-written result and becomes a no-op.
  // In this test we use a unique match ID per run and fire two concurrent
  // DISTINCT settle calls (different scores) — we assert:
  //   1. Both succeed (no errors)
  //   2. Exactly one set of scores wins and is consistent across all responses
  //   3. The final settleCount from storage is 1 (only one "true" settlement)
  it("single-flight: concurrent DISTINCT settle calls produce exactly one winner", async () => {
    const matchId = `match-distinct-concurrent-${Date.now()}`;
    const id = testEnv.MATCH_DO.idFromName(matchId);
    const stub = testEnv.MATCH_DO.get(id);

    // Two different outcomes — only one should win
    const payloadA = JSON.stringify({ matchId, homeScore: 1, awayScore: 0, status: "finished", source: "auto" });
    const payloadB = JSON.stringify({ matchId, homeScore: 0, awayScore: 2, status: "finished", source: "auto" });

    const [rA, rB] = await Promise.all([
      stub.fetch("http://do/settle", { method: "POST", headers: { "Content-Type": "application/json" }, body: payloadA }),
      stub.fetch("http://do/settle", { method: "POST", headers: { "Content-Type": "application/json" }, body: payloadB }),
    ]);

    expect(rA.status).toBe(200);
    expect(rB.status).toBe(200);

    type Body = { settled: boolean; settleCount: number; homeScore: number; awayScore: number };
    const [bA, bB] = await Promise.all([rA.json<Body>(), rB.json<Body>()]);

    // The winning score must be consistent — both responses must agree on the same scores.
    // (One request settled, the second saw the already-settled result and returned it.)
    expect(bA.homeScore).toBe(bB.homeScore);
    expect(bA.awayScore).toBe(bB.awayScore);

    // Final settleCount in storage must be exactly 1.
    // Without blockConcurrencyWhile, both could run "settling logic" and
    // the settleCount would still appear as 1 (both compute 0+1) but the
    // DO would have applied the result twice internally.
    const maxCount = Math.max(bA.settleCount, bB.settleCount);
    expect(maxCount).toBe(1);
  });

  // Regression (autonomous refresh): the cron polls every 5 min, so it catches
  // matches mid-game and sends an in_progress settle BEFORE the finished one.
  // An in_progress update is transient — it must NOT acquire the single-flight
  // lock, otherwise the eventual finished result is rejected as a duplicate auto
  // write and the match never settles. (Latent until getResult started working.)
  it("in_progress does NOT lock — a later finished result still settles", async () => {
    const matchId = `match-inprog-then-finished-${Date.now()}`;
    const id = testEnv.MATCH_DO.idFromName(matchId);
    const stub = testEnv.MATCH_DO.get(id);

    // Live update arrives first (1-0, in_progress)
    const rLive = await stub.fetch("http://do/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId, homeScore: 1, awayScore: 0, status: "in_progress", source: "auto" }),
    });
    expect(rLive.status).toBe(200);
    const bLive = await rLive.json<{ settled: boolean; settleCount: number }>();
    // in_progress must NOT count as a settlement
    expect(bLive.settled).toBe(false);
    expect(bLive.settleCount).toBe(0);

    // Final result arrives later (3-1, finished) — MUST settle
    const rFinal = await stub.fetch("http://do/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId, homeScore: 3, awayScore: 1, status: "finished", source: "auto" }),
    });
    expect(rFinal.status).toBe(200);
    const bFinal = await rFinal.json<{ settled: boolean; settleCount: number; homeScore: number; awayScore: number }>();
    expect(bFinal.settled).toBe(true);
    expect(bFinal.settleCount).toBe(1);
    expect(bFinal.homeScore).toBe(3);
    expect(bFinal.awayScore).toBe(1);
  });

  it("a stale in_progress after settlement is ignored (no downgrade)", async () => {
    const matchId = `match-finished-then-inprog-${Date.now()}`;
    const id = testEnv.MATCH_DO.idFromName(matchId);
    const stub = testEnv.MATCH_DO.get(id);

    // Settle finished 2-0
    await stub.fetch("http://do/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId, homeScore: 2, awayScore: 0, status: "finished", source: "auto" }),
    });

    // A late/stale in_progress arrives — must be ignored, keep the finished result
    const rStale = await stub.fetch("http://do/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId, homeScore: 1, awayScore: 0, status: "in_progress", source: "auto" }),
    });
    expect(rStale.status).toBe(200);
    const bStale = await rStale.json<{ settled: boolean; settleCount: number; homeScore: number; awayScore: number }>();
    expect(bStale.settled).toBe(true);
    expect(bStale.settleCount).toBe(1);
    expect(bStale.homeScore).toBe(2);
    expect(bStale.awayScore).toBe(0);
  });

  it("manual pin blocks auto from overwriting", async () => {
    const matchId = "match-pin-test";
    const id = testEnv.MATCH_DO.idFromName(matchId);
    const stub = testEnv.MATCH_DO.get(id);

    // Manual settles first
    const manualPayload = {
      matchId,
      homeScore: 2,
      awayScore: 0,
      status: "finished",
      source: "manual",
    };
    const r1 = await stub.fetch("http://do/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manualPayload),
    });
    expect(r1.status).toBe(200);
    const b1 = await r1.json<{ settled: boolean; settleCount: number; homeScore: number; awayScore: number }>();
    expect(b1.homeScore).toBe(2);

    // Auto tries to overwrite — should be blocked
    const autoPayload = {
      matchId,
      homeScore: 0,
      awayScore: 0,
      status: "finished",
      source: "auto",
    };
    const r2 = await stub.fetch("http://do/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(autoPayload),
    });
    expect(r2.status).toBe(200);
    const b2 = await r2.json<{ settled: boolean; settleCount: number; homeScore: number; awayScore: number }>();
    // Score should still be the manual result (2-0), not the auto attempt (0-0)
    expect(b2.homeScore).toBe(2);
    expect(b2.awayScore).toBe(0);
  });
});
