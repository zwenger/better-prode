/**
 * Raw HTTP handlers for push subscription endpoints.
 *
 * These handlers expose /api/push/subscribe and /api/push/unsubscribe as plain
 * HTTP POST endpoints so Playwright E2E tests can call them directly using
 * page.request.post(...) without needing to go through TanStack's server-fn
 * RPC mechanism.
 *
 * The server-fn exports in -subscribe.ts and -unsubscribe.ts remain the
 * canonical path used by the application UI. These HTTP handlers share the
 * same underlying logic.
 *
 * Registered in src/server.ts fetch interceptor (E2E-safe: always available
 * when the server is running, regardless of TEST_AUTH_BYPASS — push endpoints
 * are not test-only; they are real application endpoints that tests invoke
 * directly rather than via the UI).
 */

import { auth } from "#/infra/auth/auth";
import { getDb } from "#/infra/db/client";
import {
  DrizzlePushSubscriptionRepository,
  createPushSubscriptionRecord,
} from "#/adapters/push/push-subscription";

interface SubscribeBody {
  endpoint: string;
  p256dh?: string;
  auth?: string;
  keys?: { p256dh: string; auth: string };
}

export async function handlePushSubscribe(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SubscribeBody;
  try {
    const raw: unknown = await request.json();
    body = raw as SubscribeBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Support both flat { endpoint, p256dh, auth } and nested { endpoint, keys: { p256dh, auth } }
  const p256dh = body.p256dh ?? body.keys?.p256dh;
  const authKey = body.auth ?? body.keys?.auth;

  if (
    typeof body.endpoint !== "string" ||
    typeof p256dh !== "string" ||
    typeof authKey !== "string"
  ) {
    return Response.json({ error: "Missing required fields: endpoint, p256dh, auth" }, { status: 400 });
  }

  const db = getDb();
  const repo = new DrizzlePushSubscriptionRepository(db);

  const record = createPushSubscriptionRecord({
    userId: session.user.id,
    endpoint: body.endpoint,
    p256dh,
    auth: authKey,
  });

  await repo.store(record);

  return Response.json({ ok: true }, { status: 200 });
}

export async function handlePushUnsubscribe(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const repo = new DrizzlePushSubscriptionRepository(db);
  await repo.deleteByUserId(session.user.id);

  return Response.json({ ok: true }, { status: 200 });
}
