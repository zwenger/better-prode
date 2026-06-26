/**
 * LeaderboardCache adapters — edge cache for leaderboard results.
 *
 * The port interface lives in the domain (#/domain/ports/leaderboard-cache); this module
 * provides the concrete implementations.
 *
 * Design decision #6: edge-cache leaderboard, invalidate on recompute.
 * Key format: `leaderboard:{groupId}:{tournamentId}`
 *
 * Three implementations:
 *  - NoopLeaderboardCache — always miss, all ops no-op (safe for unit tests + local dev)
 *  - InMemoryLeaderboardCache — in-process Map (useful for integration tests and local E2E)
 *  - CacheApiLeaderboardCache — Cloudflare Cache API (production, injected via the Cloudflare
 *    execution context; exported but only available inside the Workers runtime)
 */

import type { LeaderboardCache } from "#/domain/ports/leaderboard-cache";

// ---------------------------------------------------------------------------
// Shared key builder
// ---------------------------------------------------------------------------

export function buildLeaderboardCacheKey(groupId: string, tournamentId: string): string {
  return `leaderboard:${groupId}:${tournamentId}`;
}

// ---------------------------------------------------------------------------
// NoopLeaderboardCache — always misses, no storage (safe for tests + non-cache paths)
// ---------------------------------------------------------------------------

export class NoopLeaderboardCache implements LeaderboardCache {
  async get(_groupId: string, _tournamentId: string): Promise<string | null> {
    return null;
  }

  async set(_groupId: string, _tournamentId: string, _payload: string): Promise<void> {
    // intentional no-op
  }

  async invalidate(_groupId: string, _tournamentId: string): Promise<void> {
    // intentional no-op
  }
}

// ---------------------------------------------------------------------------
// InMemoryLeaderboardCache — Map-backed (integration tests + local E2E)
// ---------------------------------------------------------------------------

export class InMemoryLeaderboardCache implements LeaderboardCache {
  private readonly store = new Map<string, string>();

  async get(groupId: string, tournamentId: string): Promise<string | null> {
    return this.store.get(buildLeaderboardCacheKey(groupId, tournamentId)) ?? null;
  }

  async set(groupId: string, tournamentId: string, payload: string): Promise<void> {
    this.store.set(buildLeaderboardCacheKey(groupId, tournamentId), payload);
  }

  async invalidate(groupId: string, tournamentId: string): Promise<void> {
    this.store.delete(buildLeaderboardCacheKey(groupId, tournamentId));
  }
}

// ---------------------------------------------------------------------------
// CacheApiLeaderboardCache — Cloudflare Cache API (Workers runtime only)
//
// Wraps the global `caches` API provided by the Cloudflare Workers runtime.
// This class is NOT usable in Node.js unit tests — use NoopLeaderboardCache
// or InMemoryLeaderboardCache instead.
//
// Cache URL scheme: https://leaderboard-cache/{key}
// TTL: 300 seconds (5 min); revalidated on invalidation.
// ---------------------------------------------------------------------------

const CACHE_BASE_URL = "https://leaderboard-cache/";
const CACHE_TTL_SECONDS = 300;

export class CacheApiLeaderboardCache implements LeaderboardCache {
  private async openCache(): Promise<Cache> {
    // `caches` is a global in the Cloudflare Workers runtime
    return (globalThis as unknown as { caches: CacheStorage }).caches.open("leaderboard-v1");
  }

  private buildUrl(groupId: string, tournamentId: string): string {
    return `${CACHE_BASE_URL}${buildLeaderboardCacheKey(groupId, tournamentId)}`;
  }

  async get(groupId: string, tournamentId: string): Promise<string | null> {
    const cache = await this.openCache();
    const response = await cache.match(this.buildUrl(groupId, tournamentId));
    if (!response) return null;
    return response.text();
  }

  async set(groupId: string, tournamentId: string, payload: string): Promise<void> {
    const cache = await this.openCache();
    const response = new Response(payload, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
      },
    });
    await cache.put(this.buildUrl(groupId, tournamentId), response);
  }

  async invalidate(groupId: string, tournamentId: string): Promise<void> {
    const cache = await this.openCache();
    await cache.delete(this.buildUrl(groupId, tournamentId));
  }
}
