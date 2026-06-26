/**
 * TDD: LeaderboardCache port + NoopCache + CacheApiCache tests (tasks 4.1–4.3 RED)
 *
 * Spec (leaderboard): cache must be invalidated whenever applyMatchResult writes
 * new points; simultaneous refresh spike absorbed by edge cache.
 *
 * Design: Cache API or KV wrapper, key `leaderboard:{groupId}:{tournamentId}`.
 * NoopCache for tests (no real Cache API needed).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  NoopLeaderboardCache,
  InMemoryLeaderboardCache,
  buildLeaderboardCacheKey,
} from "./leaderboard-cache";
import type { LeaderboardCache } from "#/domain/ports/leaderboard-cache";

const GROUP_ID = "group-1";
const TOURNAMENT_ID = "wc-2026";
const SAMPLE_PAYLOAD = JSON.stringify([
  { userId: "u1", totalPoints: 7 },
  { userId: "u2", totalPoints: 3 },
]);

describe("buildLeaderboardCacheKey", () => {
  it("returns a deterministic key for a given group + tournament", () => {
    const key = buildLeaderboardCacheKey(GROUP_ID, TOURNAMENT_ID);
    expect(key).toBe("leaderboard:group-1:wc-2026");
  });

  it("different groups produce different keys", () => {
    const k1 = buildLeaderboardCacheKey("g1", TOURNAMENT_ID);
    const k2 = buildLeaderboardCacheKey("g2", TOURNAMENT_ID);
    expect(k1).not.toBe(k2);
  });
});

describe("NoopLeaderboardCache", () => {
  let cache: LeaderboardCache;

  beforeEach(() => {
    cache = new NoopLeaderboardCache();
  });

  it("get always returns null (no storage)", async () => {
    const result = await cache.get(GROUP_ID, TOURNAMENT_ID);
    expect(result).toBeNull();
  });

  it("set is a no-op (no error thrown)", async () => {
    await expect(cache.set(GROUP_ID, TOURNAMENT_ID, SAMPLE_PAYLOAD)).resolves.not.toThrow();
  });

  it("invalidate is a no-op (no error thrown)", async () => {
    await expect(cache.invalidate(GROUP_ID, TOURNAMENT_ID)).resolves.not.toThrow();
  });
});

describe("InMemoryLeaderboardCache", () => {
  let cache: InMemoryLeaderboardCache;

  beforeEach(() => {
    cache = new InMemoryLeaderboardCache();
  });

  it("get returns null when key is not set", async () => {
    const result = await cache.get(GROUP_ID, TOURNAMENT_ID);
    expect(result).toBeNull();
  });

  it("set stores a value and get retrieves it", async () => {
    await cache.set(GROUP_ID, TOURNAMENT_ID, SAMPLE_PAYLOAD);
    const result = await cache.get(GROUP_ID, TOURNAMENT_ID);
    expect(result).toBe(SAMPLE_PAYLOAD);
  });

  it("invalidate removes the stored value", async () => {
    await cache.set(GROUP_ID, TOURNAMENT_ID, SAMPLE_PAYLOAD);
    await cache.invalidate(GROUP_ID, TOURNAMENT_ID);
    const result = await cache.get(GROUP_ID, TOURNAMENT_ID);
    expect(result).toBeNull();
  });

  it("invalidating a non-existent key does not throw", async () => {
    await expect(cache.invalidate("no-group", "no-tournament")).resolves.not.toThrow();
  });

  it("different group+tournament combinations are stored independently", async () => {
    await cache.set("g1", TOURNAMENT_ID, "data-g1");
    await cache.set("g2", TOURNAMENT_ID, "data-g2");

    expect(await cache.get("g1", TOURNAMENT_ID)).toBe("data-g1");
    expect(await cache.get("g2", TOURNAMENT_ID)).toBe("data-g2");

    await cache.invalidate("g1", TOURNAMENT_ID);
    expect(await cache.get("g1", TOURNAMENT_ID)).toBeNull();
    // g2 must be unaffected
    expect(await cache.get("g2", TOURNAMENT_ID)).toBe("data-g2");
  });

  it("overwriting a key with set replaces the previous value", async () => {
    await cache.set(GROUP_ID, TOURNAMENT_ID, "old");
    await cache.set(GROUP_ID, TOURNAMENT_ID, "new");
    expect(await cache.get(GROUP_ID, TOURNAMENT_ID)).toBe("new");
  });
});
