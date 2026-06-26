/**
 * POST /api/push/unsubscribe
 *
 * Deletes the Web Push subscription for the authenticated user.
 * No body required — we identify the user from the session.
 *
 * Follows the `-` prefix server-file convention (non-route server handler).
 * Task 5.4.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { auth } from "#/infra/auth/auth";
import { getDb } from "#/infra/db/client";
import { DrizzlePushSubscriptionRepository } from "#/adapters/push/push-subscription";

export const unsubscribePush = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: boolean }> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    }

    const db = getDb();
    const repo = new DrizzlePushSubscriptionRepository(db);
    await repo.deleteByUserId(session.user.id);

    return { ok: true };
  }
);
