/**
 * DrizzleGroupRepository — implements GroupRepository port against Turso/libSQL.
 *
 * Task 2.9 (GREEN): Drizzle-based implementation for groups + memberships.
 * Follows the same pattern as DrizzleMatchRepository and DrizzlePredictionRepository.
 *
 * Design decision #1: domain depends on nothing; adapters implement ports.
 */

import { eq, and, sql } from "drizzle-orm";
import type { DrizzleDb } from "#/infra/db/client";
import { group as groupTable, groupMembership as membershipTable } from "#/infra/db/schema";
import type {
  GroupRepository,
  GroupRecord,
  GroupMembershipRecord,
  GroupRole,
} from "#/domain/ports/repositories";

export class DrizzleGroupRepository implements GroupRepository {
  constructor(private readonly db: DrizzleDb) {}

  async getById(id: string): Promise<GroupRecord | null> {
    const rows = await this.db
      .select()
      .from(groupTable)
      .where(eq(groupTable.id, id))
      .limit(1);

    if (rows.length === 0) return null;
    return this.rowToGroupRecord(rows[0]);
  }

  async create(group: GroupRecord): Promise<GroupRecord> {
    await this.db.insert(groupTable).values({
      id: group.id,
      name: group.name,
      ownerId: group.ownerId,
      createdAt: group.createdAt,
    });
    return group;
  }

  async addMembership(membership: GroupMembershipRecord): Promise<void> {
    await this.db.insert(membershipTable).values({
      groupId: membership.groupId,
      userId: membership.userId,
      role: membership.role,
      joinedAt: membership.joinedAt,
    });
  }

  async getMembership(groupId: string, userId: string): Promise<GroupMembershipRecord | null> {
    const rows = await this.db
      .select()
      .from(membershipTable)
      .where(
        and(eq(membershipTable.groupId, groupId), eq(membershipTable.userId, userId))
      )
      .limit(1);

    if (rows.length === 0) return null;
    return this.rowToMembershipRecord(rows[0]);
  }

  async listMemberships(groupId: string): Promise<GroupMembershipRecord[]> {
    const rows = await this.db
      .select()
      .from(membershipTable)
      .where(eq(membershipTable.groupId, groupId));

    return rows.map(this.rowToMembershipRecord);
  }

  async updateMembershipRole(groupId: string, userId: string, role: GroupRole): Promise<void> {
    await this.db
      .update(membershipTable)
      .set({ role })
      .where(
        and(eq(membershipTable.groupId, groupId), eq(membershipTable.userId, userId))
      );
  }

  async removeMembership(groupId: string, userId: string): Promise<void> {
    await this.db
      .delete(membershipTable)
      .where(
        and(eq(membershipTable.groupId, groupId), eq(membershipTable.userId, userId))
      );
  }

  async listByUser(userId: string): Promise<Array<GroupRecord & { role: GroupRole }>> {
    const rows = await this.db
      .select({
        id: groupTable.id,
        name: groupTable.name,
        ownerId: groupTable.ownerId,
        createdAt: groupTable.createdAt,
        role: membershipTable.role,
      })
      .from(membershipTable)
      .innerJoin(groupTable, eq(membershipTable.groupId, groupTable.id))
      .where(eq(membershipTable.userId, userId));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      ownerId: row.ownerId,
      createdAt: row.createdAt,
      role: row.role,
    }));
  }

  /**
   * Returns distinct group IDs that have at least one member with a prediction
   * in the given tournament.
   *
   * W-1 fix: called by applyMatchResult after points are written to enumerate
   * which leaderboard caches to invalidate.
   *
   * SQL equivalent:
   *   SELECT DISTINCT gm.group_id
   *   FROM group_membership gm
   *   INNER JOIN prediction p ON p.user_id = gm.user_id
   *   INNER JOIN match m ON m.id = p.match_id
   *   WHERE m.tournament_id = ?
   */
  async listGroupIdsByTournament(tournamentId: string): Promise<string[]> {
    const rows = await this.db.all<{ groupId: string }>(sql`
      SELECT DISTINCT gm.group_id AS groupId
      FROM group_membership gm
      INNER JOIN prediction p ON p.user_id = gm.user_id
      INNER JOIN match m ON m.id = p.match_id
      WHERE m.tournament_id = ${tournamentId}
    `);
    return rows.map((r) => r.groupId);
  }

  private rowToGroupRecord(row: typeof groupTable.$inferSelect): GroupRecord {
    return {
      id: row.id,
      name: row.name,
      ownerId: row.ownerId,
      createdAt: row.createdAt,
    };
  }

  private rowToMembershipRecord(row: typeof membershipTable.$inferSelect): GroupMembershipRecord {
    return {
      groupId: row.groupId,
      userId: row.userId,
      role: row.role,
      joinedAt: row.joinedAt,
    };
  }
}
