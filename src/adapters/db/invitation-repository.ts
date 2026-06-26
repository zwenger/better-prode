/**
 * DrizzleInvitationRepository — implements InvitationRepository port against Turso/libSQL.
 *
 * Task 2.9 (GREEN): Drizzle-based implementation for group invitations.
 * Follows the same pattern as DrizzleMatchRepository and DrizzlePredictionRepository.
 *
 * Design decision #1: domain depends on nothing; adapters implement ports.
 */

import { eq, and } from "drizzle-orm";
import type { DrizzleDb } from "#/infra/db/client";
import { invitation as invitationTable } from "#/infra/db/schema";
import type {
  InvitationRepository,
  InvitationRecord,
  InvitationStatus,
} from "#/domain/ports/repositories";

export class DrizzleInvitationRepository implements InvitationRepository {
  constructor(private readonly db: DrizzleDb) {}

  async getByToken(token: string): Promise<InvitationRecord | null> {
    const rows = await this.db
      .select()
      .from(invitationTable)
      .where(eq(invitationTable.token, token))
      .limit(1);

    if (rows.length === 0) return null;
    return this.rowToRecord(rows[0]);
  }

  async create(invitation: InvitationRecord): Promise<InvitationRecord> {
    await this.db.insert(invitationTable).values({
      id: invitation.id,
      groupId: invitation.groupId,
      token: invitation.token,
      status: invitation.status,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt ?? null,
    });
    return invitation;
  }

  async updateStatus(id: string, status: InvitationStatus): Promise<void> {
    await this.db
      .update(invitationTable)
      .set({ status })
      .where(eq(invitationTable.id, id));
  }

  async getActiveByGroup(groupId: string): Promise<InvitationRecord | null> {
    const rows = await this.db
      .select()
      .from(invitationTable)
      .where(
        and(
          eq(invitationTable.groupId, groupId),
          eq(invitationTable.status, "pending")
        )
      )
      .limit(1);

    if (rows.length === 0) return null;
    return this.rowToRecord(rows[0]);
  }

  private rowToRecord(row: typeof invitationTable.$inferSelect): InvitationRecord {
    return {
      id: row.id,
      groupId: row.groupId,
      token: row.token,
      status: row.status,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt ?? null,
    };
  }
}
