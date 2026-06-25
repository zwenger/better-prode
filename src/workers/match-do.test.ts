/**
 * TDD: MatchDO Durable Object tests (task 1.9 RED → 1.10 GREEN)
 *
 * Spec (result-triggering, testability):
 *  - Per-match DO provides single-flight around settlement
 *  - 100 concurrent fetch() calls → exactly 1 applyMatchResult invocation
 *  - Idempotency: repeated calls with same args → no-op
 *  - Uses @cloudflare/vitest-pool-workers (real workerd runtime)
 *  - Mock DO is NOT acceptable for single-flight proof
 *
 * The DO serializes requests via its single-threaded execution model.
 * We verify that the settlement logic (tracked via a counter written to
 * DO storage) runs exactly once even under thundering herd.
 */

import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";

describe("MatchDO — single-flight settlement", () => {
  beforeEach(async () => {
    // Each test gets isolated storage via the workers project
  });

  it("single fetch call returns 200 and settles the match", async () => {
    const id = env.MATCH_DO.idFromName("match-single-flight-test");
    const stub = env.MATCH_DO.get(id);

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
    const body = await response.json() as { settled: boolean; settleCount: number };
    expect(body.settled).toBe(true);
    expect(body.settleCount).toBe(1);
  });

  it("100 concurrent fetch() calls → exactly 1 settlement (single-flight)", async () => {
    const matchId = "match-concurrent-test";
    const id = env.MATCH_DO.idFromName(matchId);
    const stub = env.MATCH_DO.get(id);

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
    const bodies = await Promise.all(
      responses.map((r) => r.json() as Promise<{ settled: boolean; settleCount: number }>)
    );
    const maxSettleCount = Math.max(...bodies.map((b) => b.settleCount));
    expect(maxSettleCount).toBe(1);
  });

  it("idempotent — same args on repeated calls → no additional settlement", async () => {
    const matchId = "match-idempotent-test";
    const id = env.MATCH_DO.idFromName(matchId);
    const stub = env.MATCH_DO.get(id);

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
    const b1 = await r1.json() as { settled: boolean; settleCount: number };
    expect(b1.settleCount).toBe(1);

    // Second call with same payload — no-op
    const r2 = await stub.fetch("http://do/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(r2.status).toBe(200);
    const b2 = await r2.json() as { settled: boolean; settleCount: number };
    // Still 1 — did not re-settle
    expect(b2.settleCount).toBe(1);
  });

  it("manual pin blocks auto from overwriting", async () => {
    const matchId = "match-pin-test";
    const id = env.MATCH_DO.idFromName(matchId);
    const stub = env.MATCH_DO.get(id);

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
    const b1 = await r1.json() as { settled: boolean; settleCount: number; homeScore: number; awayScore: number };
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
    const b2 = await r2.json() as { settled: boolean; settleCount: number; homeScore: number; awayScore: number };
    // Score should still be the manual result (2-0), not the auto attempt (0-0)
    expect(b2.homeScore).toBe(2);
    expect(b2.awayScore).toBe(0);
  });
});
