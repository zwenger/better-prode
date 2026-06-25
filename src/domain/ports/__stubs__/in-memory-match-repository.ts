/**
 * In-memory MatchRepository stub — for unit tests only.
 *
 * Implements the MatchRepository port with a simple Map.
 * Does NOT require any DB connection or infrastructure.
 */

import type { MatchRepository, MatchRecord } from "#/domain/ports/repositories";

export class InMemoryMatchRepository implements MatchRepository {
  private store: Map<string, MatchRecord>;

  constructor(initialMatches: MatchRecord[] = []) {
    this.store = new Map(initialMatches.map((m) => [m.id, { ...m }]));
  }

  async getById(id: string): Promise<MatchRecord | null> {
    return this.store.get(id) ?? null;
  }

  async updateResult(
    id: string,
    update: Partial<
      Pick<
        MatchRecord,
        "homeScore" | "awayScore" | "resultSource" | "settledAt" | "status"
      >
    >
  ): Promise<void> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`InMemoryMatchRepository: match ${id} not found`);
    this.store.set(id, { ...existing, ...update });
  }

  /** Test helper: read the current state of a match. */
  peek(id: string): MatchRecord | null {
    return this.store.get(id) ?? null;
  }
}
