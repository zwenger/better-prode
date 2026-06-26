/**
 * POST /api/push/subscribe
 *
 * Stores a Web Push subscription for the authenticated user.
 * Body: { endpoint: string; keys: { p256dh: string; auth: string } }
 *
 * Follows the `-` prefix server-file convention (non-route server handler).
 * Task 5.4.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { auth } from "#/infra/auth/auth";
import { getDb } from "#/infra/db/client";
import {
  DrizzlePushSubscriptionRepository,
  createPushSubscriptionRecord,
} from "#/adapters/push/push-subscription";

export interface SubscribeInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export const subscribePush = createServerFn({ method: "POST" })
  .validator((data: unknown): SubscribeInput => {
    const raw = data as Record<string, unknown>;
    const rawKeys = typeof raw["keys"] === "object" && raw["keys"] !== null
      ? raw["keys"] as Record<string, unknown>
      : {};
    if (
      typeof raw["endpoint"] !== "string" ||
      typeof rawKeys["p256dh"] !== "string" ||
      typeof rawKeys["auth"] !== "string"
    ) {
      throw Object.assign(new Error("Invalid subscription payload"), { status: 400 });
    }
    return data as SubscribeInput;
  })
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    }

    const db = getDb();
    const repo = new DrizzlePushSubscriptionRepository(db);

    const record = createPushSubscriptionRecord({
      userId: session.user.id,
      endpoint: data.endpoint,
      p256dh: data.keys.p256dh,
      auth: data.keys.auth,
    });

    await repo.store(record);

    return { ok: true };
  });
