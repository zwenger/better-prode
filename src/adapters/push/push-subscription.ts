/**
 * Push Subscription adapter — Web Push subscription management.
 *
 * Port interfaces (PushSubscriptionRepository, PushSender) are defined here
 * alongside the in-memory stub so the domain can depend on these shapes
 * without knowing about the concrete transport (web-push library).
 *
 * Task 5.2 (GREEN): Implements:
 *  - PushSubscriptionRecord — the domain record shape
 *  - PushSubscriptionRepository port — store / delete / query subscriptions
 *  - PushSender port — thin abstraction over the push-send transport
 *  - InMemoryPushSubscriptionRepository — in-process stub for tests
 *  - WebPushSender — concrete sender using the `web-push` library (Node.js)
 *  - DrizzlePushSubscriptionRepository — persistence adapter (Turso/libSQL)
 *  - sendReminderToNonPredictors — orchestration helper for the DO alarm
 *
 * Design notes:
 *  - PushSender is an interface so tests can swap in a fake; the real sender
 *    lives in this file but is never imported in the workers runtime test pool.
 *  - 410 Gone on send → subscription deleted, no retry.
 *  - The `web-push` library uses Node's `https` module — this adapter is
 *    invoked from the DO in the server-side (Turso) path, not the Workers
 *    fetch() path directly.
 */

import type { DrizzleDb } from "#/infra/db/client";
import { pushSubscription as pushSubTable } from "#/infra/db/schema";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Domain records & ports
// ---------------------------------------------------------------------------

export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: string;
}

export interface PushSubscriptionRepository {
  /** Store (upsert) a subscription for a user. Overwrites an existing one. */
  store: (record: PushSubscriptionRecord) => Promise<void>;
  /** Return the subscription for a user, or null if none. */
  getByUserId: (userId: string) => Promise<PushSubscriptionRecord | null>;
  /** Delete a user's subscription (user revoked, or 410 cleanup). */
  deleteByUserId: (userId: string) => Promise<void>;
  /** Batch lookup — return subscriptions for multiple user IDs. */
  listByUserIds: (userIds: string[]) => Promise<PushSubscriptionRecord[]>;
}

export interface PushPayload {
  title: string;
  body: string;
  matchId: string;
}

export interface PushSender {
  send: (subscription: PushSubscriptionRecord, payload: PushPayload) => Promise<void>;
}

// ---------------------------------------------------------------------------
// InMemoryPushSubscriptionRepository — test stub
// ---------------------------------------------------------------------------

export class InMemoryPushSubscriptionRepository implements PushSubscriptionRepository {
  private readonly _map = new Map<string, PushSubscriptionRecord>();

  async store(record: PushSubscriptionRecord): Promise<void> {
    // Keyed by userId — one subscription per user in the MVP
    this._map.set(record.userId, record);
  }

  async getByUserId(userId: string): Promise<PushSubscriptionRecord | null> {
    return this._map.get(userId) ?? null;
  }

  async deleteByUserId(userId: string): Promise<void> {
    this._map.delete(userId);
  }

  async listByUserIds(userIds: string[]): Promise<PushSubscriptionRecord[]> {
    const results: PushSubscriptionRecord[] = [];
    for (const uid of userIds) {
      const sub = this._map.get(uid);
      if (sub) results.push(sub);
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// DrizzlePushSubscriptionRepository — Turso/libSQL persistence adapter
// ---------------------------------------------------------------------------

export class DrizzlePushSubscriptionRepository implements PushSubscriptionRepository {
  constructor(private readonly db: DrizzleDb) {}

  async store(record: PushSubscriptionRecord): Promise<void> {
    await this.db
      .insert(pushSubTable)
      .values({
        id: record.id,
        userId: record.userId,
        endpoint: record.endpoint,
        p256dh: record.p256dh,
        auth: record.auth,
        createdAt: record.createdAt,
      })
      .onConflictDoUpdate({
        target: [pushSubTable.userId],
        set: {
          endpoint: record.endpoint,
          p256dh: record.p256dh,
          auth: record.auth,
        },
      });
  }

  async getByUserId(userId: string): Promise<PushSubscriptionRecord | null> {
    const rows = await this.db
      .select()
      .from(pushSubTable)
      .where(eq(pushSubTable.userId, userId))
      .limit(1);

    return rows.length > 0 ? this.rowToRecord(rows[0]) : null;
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.db.delete(pushSubTable).where(eq(pushSubTable.userId, userId));
  }

  async listByUserIds(userIds: string[]): Promise<PushSubscriptionRecord[]> {
    if (userIds.length === 0) return [];

    const rows = await this.db
      .select()
      .from(pushSubTable)
      .where(inArray(pushSubTable.userId, userIds));

    return rows.map(this.rowToRecord);
  }

  private rowToRecord(row: {
    id: string;
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    createdAt: string;
  }): PushSubscriptionRecord {
    return {
      id: row.id,
      userId: row.userId,
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
      createdAt: row.createdAt,
    };
  }
}

// ---------------------------------------------------------------------------
// WebPushSender — concrete sender using the web-push library
//
// web-push has no built-in TypeScript types (no @types/web-push available).
// We inline the minimal type declarations needed for our call surface.
// ---------------------------------------------------------------------------

interface WebPushModule {
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
  sendNotification: (
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options?: { TTL?: number }
  ) => Promise<{ statusCode: number }>;
}

export class WebPushSender implements PushSender {
  private readonly wp: WebPushModule;

  constructor(options: {
    vapidSubject: string;
    vapidPublicKey: string;
    vapidPrivateKey: string;
  }) {
    // Dynamic require keeps this out of the Workers runtime bundle.
    // This class is only instantiated in the Node.js / server-side path
    // (inside the Turso-connected DO settlement logic).
    this.wp = require("web-push") as WebPushModule;
    this.wp.setVapidDetails(
      options.vapidSubject,
      options.vapidPublicKey,
      options.vapidPrivateKey
    );
  }

  async send(subscription: PushSubscriptionRecord, payload: PushPayload): Promise<void> {
    await this.wp.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      JSON.stringify(payload),
      { TTL: 3600 } // 1 hour TTL — match reminder
    );
  }
}

// ---------------------------------------------------------------------------
// sendReminderToNonPredictors — orchestration helper
//
// Called by the DO alarm when the reminder fires at kickoff - 30min.
// Sends Web Push only to users who:
//   1. Are members of the relevant groups (allGroupUserIds)
//   2. Have NOT yet predicted for the match (not in predictorUserIds)
//   3. Have an active push subscription
//
// 410 Gone from the push service → subscription deleted, no retry.
// Other errors → logged, not rethrown (best-effort delivery).
// ---------------------------------------------------------------------------

export async function sendReminderToNonPredictors(options: {
  allGroupUserIds: string[];
  predictorUserIds: string[];
  matchId: string;
  subscriptionRepo: PushSubscriptionRepository;
  sender: PushSender;
}): Promise<void> {
  const { allGroupUserIds, predictorUserIds, matchId, subscriptionRepo, sender } = options;

  const predictorSet = new Set(predictorUserIds);
  const nonPredictors = allGroupUserIds.filter((uid) => !predictorSet.has(uid));

  if (nonPredictors.length === 0) return;

  // Batch-load subscriptions for non-predictors
  const subscriptions = await subscriptionRepo.listByUserIds(nonPredictors);

  if (subscriptions.length === 0) return;

  const payload: PushPayload = {
    title: "Recordatorio: ¡Predecí tu resultado!",
    body: `El partido está a punto de comenzar. Aún no enviaste tu predicción.`,
    matchId,
  };

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await sender.send(sub, payload);
      } catch (err) {
        const statusCode = (err as Error & { statusCode?: number }).statusCode;
        if (statusCode === 410) {
          // Subscription expired — clean up so we don't attempt delivery again
          await subscriptionRepo.deleteByUserId(sub.userId);
        }
        // Other errors: swallow (best-effort delivery); do not crash the alarm
      }
    })
  );
}

// ---------------------------------------------------------------------------
// Factory helper — creates a push sender from environment variables
// Returns null when VAPID keys are not configured (disables push in dev).
// ---------------------------------------------------------------------------

export function createWebPushSenderFromEnv(env: {
  VAPID_SUBJECT?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
}): WebPushSender | null {
  const { VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = env;
  if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return null;
  return new WebPushSender({
    vapidSubject: VAPID_SUBJECT,
    vapidPublicKey: VAPID_PUBLIC_KEY,
    vapidPrivateKey: VAPID_PRIVATE_KEY,
  });
}

// ---------------------------------------------------------------------------
// Convenience factory for generating a new push subscription record
// ---------------------------------------------------------------------------

export function createPushSubscriptionRecord(options: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}): PushSubscriptionRecord {
  return {
    id: randomUUID(),
    userId: options.userId,
    endpoint: options.endpoint,
    p256dh: options.p256dh,
    auth: options.auth,
    createdAt: new Date().toISOString(),
  };
}
