/**
 * LeaderboardCache port — domain-owned interface for the edge leaderboard cache.
 *
 * The domain depends on this abstraction; adapters in src/adapters/cache implement it.
 * Per hexagonal architecture, the port lives in the domain and dependencies point inward:
 * adapters import this interface, never the reverse.
 *
 * Spec (leaderboard): cache invalidated when applyMatchResult writes new points; a
 * simultaneous refresh spike is absorbed by the edge cache (one DB query, rest from cache).
 * Key format: `leaderboard:{groupId}:{tournamentId}`
 */

export interface LeaderboardCache {
  /** Returns the cached JSON string, or null on miss. */
  get: (groupId: string, tournamentId: string) => Promise<string | null>;
  /** Stores a JSON string payload. */
  set: (groupId: string, tournamentId: string, payload: string) => Promise<void>;
  /** Removes a cached entry so the next read goes to the DB. */
  invalidate: (groupId: string, tournamentId: string) => Promise<void>;
}
