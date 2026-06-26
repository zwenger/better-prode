/**
 * In-memory PredictionRepository stub — for unit tests only.
 *
 * Implements the PredictionRepository port with a simple array.
 * Does NOT require any DB connection or infrastructure.
 */

import type {
  PredictionRepository,
  PredictionRecord,
} from "#/domain/ports/repositories";

export class InMemoryPredictionRepository implements PredictionRepository {
  private store: PredictionRecord[];

  constructor(initialPredictions: PredictionRecord[] = []) {
    this.store = initialPredictions.map((p) => ({ ...p }));
  }

  async listByMatch(matchId: string): Promise<PredictionRecord[]> {
    return this.store.filter((p) => p.matchId === matchId).map((p) => ({ ...p }));
  }

  async updatePoints(predictionId: string, points: number): Promise<void> {
    const pred = this.store.find((p) => p.id === predictionId);
    if (!pred) {
      throw new Error(
        `InMemoryPredictionRepository: prediction ${predictionId} not found`
      );
    }
    pred.points = points;
  }

  async upsert(
    prediction: Omit<PredictionRecord, "id" | "points"> & { id?: string }
  ): Promise<PredictionRecord> {
    const existing = this.store.find(
      (p) =>
        p.userId === prediction.userId && p.matchId === prediction.matchId
    );
    if (existing) {
      existing.homeGoals = prediction.homeGoals;
      existing.awayGoals = prediction.awayGoals;
      return { ...existing };
    }
    const id = prediction.id ?? `pred-${Date.now()}-${Math.random()}`;
    const record: PredictionRecord = { ...prediction, id, points: null };
    this.store.push(record);
    return { ...record };
  }

  async findByUserForMatches(
    userId: string,
    matchIds: string[]
  ): Promise<Map<string, PredictionRecord>> {
    const map = new Map<string, PredictionRecord>();
    if (matchIds.length === 0) return map;
    const matchIdSet = new Set(matchIds);
    for (const pred of this.store) {
      if (pred.userId === userId && matchIdSet.has(pred.matchId)) {
        map.set(pred.matchId, { ...pred });
      }
    }
    return map;
  }

  /** Test helper: read all predictions. */
  all(): PredictionRecord[] {
    return [...this.store];
  }
}
