/**
 * In-memory ResultSource stub — for unit tests only.
 */

import type { ResultSource, MatchResult } from "#/domain/ports/result-source";

export class InMemoryResultSource implements ResultSource {
  private results: Map<string, MatchResult>;

  constructor(results: MatchResult[] = []) {
    this.results = new Map(results.map((r) => [r.matchId, r]));
  }

  async getResult(matchId: string): Promise<MatchResult | null> {
    return this.results.get(matchId) ?? null;
  }

  /** Test helper: set a result. */
  setResult(result: MatchResult): void {
    this.results.set(result.matchId, result);
  }
}
