/**
 * Repository port interfaces — hexagonal boundary.
 *
 * Domain code depends ONLY on these interfaces.
 * Concrete adapters (Turso/libSQL) live in src/adapters/db/.
 *
 * Design decision #1: domain depends on nothing; adapters implement these ports.
 */

import type {
  MatchRecord,
  PredictionRecord,
  MatchStatus,
  ResultSource,
} from "#/domain/apply-match-result";

export type { MatchRecord, PredictionRecord };

// Re-export typed domain error for duplicate prediction (task 2.4)
export { DuplicatePredictionError } from "#/domain/ports/duplicate-prediction";

/**
 * MatchRepository port — read/write match records.
 */
/**
 * DTO for a match row with team names/codes resolved — returned by getTeamMatches.
 * Defined in the port so domain and adapters share a single source of truth.
 */
export interface TeamMatchRow {
  id: string;
  homeName: string;
  homeCode: string | null;
  awayName: string;
  awayCode: string | null;
  kickoffUtc: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  groupLabel: string | null;
}

export interface MatchRepository {
  getById: (id: string) => Promise<MatchRecord | null>;
  updateResult: (
    id: string,
    update: Partial<
      Pick<
        MatchRecord,
        | "homeScore"
        | "awayScore"
        | "resultSource"
        | "settledAt"
        | "status"
        | "homePenaltyScore"
        | "awayPenaltyScore"
        | "winnerTeamId"
      >
    >
  ) => Promise<void>;
  getTeamMatches: (teamCode: string) => Promise<TeamMatchRow[]>;
}

/**
 * PredictionRepository port — read/write prediction records.
 */
export interface PredictionRepository {
  /** Get all predictions for a given match. */
  listByMatch: (matchId: string) => Promise<PredictionRecord[]>;
  /** Update the stored points for a specific prediction after settlement. */
  updatePoints: (predictionId: string, points: number) => Promise<void>;
  /**
   * Insert or update a prediction for (userId, matchId).
   * Throws `DUPLICATE_PREDICTION` domain error if the DB UNIQUE constraint
   * fires in an unexpected context (should not happen with upsert).
   */
  upsert: (prediction: Omit<PredictionRecord, "id" | "points"> & { id?: string }) => Promise<PredictionRecord>;
  /**
   * Batch lookup of a single user's predictions for a set of matches.
   *
   * Task 4.6 — fixes the "saved prediction reverts to 0-0 on reload" bug:
   * the match-list loader calls this to hydrate each PredictableCard with the
   * user's existing prediction so the steppers start at the saved values.
   *
   * Returns a Map<matchId, PredictionRecord> for O(1) lookup per card.
   * Returns an empty Map when matchIds is empty (no query issued).
   */
  findByUserForMatches: (
    userId: string,
    matchIds: string[]
  ) => Promise<Map<string, PredictionRecord>>;
}

// Re-export types used by adapters
export type { MatchStatus, ResultSource };

// ---------------------------------------------------------------------------
// Group domain records (task 2.7)
// ---------------------------------------------------------------------------

export interface GroupRecord {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
}

export type GroupRole = "owner" | "admin" | "member";

export interface GroupMembershipRecord {
  groupId: string;
  userId: string;
  role: GroupRole;
  joinedAt: string;
}

export type InvitationStatus = "pending" | "accepted" | "rejected" | "revoked";

export interface InvitationRecord {
  id: string;
  groupId: string;
  token: string;
  status: InvitationStatus;
  createdAt: string;
  expiresAt?: string | null;
}

/**
 * GroupRepository port — CRUD for groups + memberships.
 */
export interface GroupRepository {
  getById: (id: string) => Promise<GroupRecord | null>;
  create: (group: GroupRecord) => Promise<GroupRecord>;
  addMembership: (membership: GroupMembershipRecord) => Promise<void>;
  getMembership: (groupId: string, userId: string) => Promise<GroupMembershipRecord | null>;
  listMemberships: (groupId: string) => Promise<GroupMembershipRecord[]>;
  updateMembershipRole: (groupId: string, userId: string, role: GroupRole) => Promise<void>;
  removeMembership: (groupId: string, userId: string) => Promise<void>;
  /** List all groups a user is a member of. */
  listByUser: (userId: string) => Promise<Array<GroupRecord & { role: GroupRole }>>;
  /**
   * Returns distinct group IDs that have at least one member with a prediction
   * in the given tournament.
   *
   * W-1 fix: used by applyMatchResult to enumerate which leaderboard cache
   * entries to invalidate after a match settles in that tournament.
   *
   * The join path is: group_membership → prediction → match.tournament_id.
   * Only groups whose members have actually made a prediction in the tournament
   * are returned — groups with no predictions are unaffected.
   */
  listGroupIdsByTournament: (tournamentId: string) => Promise<string[]>;
}

/**
 * InvitationRepository port — CRUD for group invitations.
 */
export interface InvitationRepository {
  getByToken: (token: string) => Promise<InvitationRecord | null>;
  create: (invitation: InvitationRecord) => Promise<InvitationRecord>;
  updateStatus: (id: string, status: InvitationStatus) => Promise<void>;
  /** Get the currently active (pending) invitation for a group, if any. */
  getActiveByGroup: (groupId: string) => Promise<InvitationRecord | null>;
}
