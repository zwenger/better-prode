/**
 * TDD W-PR5-3: Integration tests for push subscribe/unsubscribe HTTP handlers.
 *
 * Covers the real behavior of handlePushSubscribe and handlePushUnsubscribe:
 *  - Authenticated subscribe → subscription persisted in DB (DrizzlePushSubscriptionRepository)
 *  - Authenticated unsubscribe → subscription removed from DB
 *  - Unauthenticated request → 401 (auth guard works)
 *  - Missing required fields → 400
 *
 * Strategy: mock auth.api.getSession (session layer) and getDb() (DB singleton)
 * so we can inject a real in-memory libSQL DB. The repository used by the handler
 * is the real DrizzlePushSubscriptionRepository — this is NOT a stub-only test.
 * We assert actual persistence and removal through the repo, not just status codes.
 *
 * Note: vi.mock() calls are automatically hoisted by Vitest to the top of the
 * module before any imports, so they always take effect regardless of declaration
 * order in the source file.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb } from "#/adapters/db/test-helpers";
import { DrizzlePushSubscriptionRepository } from "#/adapters/push/push-subscription";
import { handlePushSubscribe, handlePushUnsubscribe } from "./-push-http";
import { auth } from "#/infra/auth/auth";
import { getDb } from "#/infra/db/client";

// ---------------------------------------------------------------------------
// Module mocks — Vitest hoists these before any imports automatically
// ---------------------------------------------------------------------------

vi.mock("#/infra/auth/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

// Partial mock: preserve createDrizzleDb (used by test-helpers) and override getDb only
vi.mock("#/infra/db/client", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("#/infra/db/client")>();
  return {
    ...actual,
    getDb: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAuthenticatedSession(userId = "user-test-123") {
  const now = new Date();
  return {
    session: {
      id: "session-test",
      userId,
      token: "test-token",
      expiresAt: new Date(now.getTime() + 86_400_000), // 24h from now
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
    user: {
      id: userId,
      name: "Test User",
      email: `${userId}@test.com`,
      emailVerified: false,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  };
}

function makeSubscribeRequest(body: object, sessionHeaderValue = "Bearer token") {
  return new Request("https://example.com/api/push/subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: sessionHeaderValue,
    },
    body: JSON.stringify(body),
  });
}

function makeUnsubscribeRequest(sessionHeaderValue = "Bearer token") {
  return new Request("https://example.com/api/push/unsubscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: sessionHeaderValue,
    },
    body: JSON.stringify({}),
  });
}

async function seedUser(client: Client, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO "user"(id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 0, NULL, ?, ?)`,
    args: [userId, "Test User", `${userId}@test.com`, now, now],
  });
}

// ---------------------------------------------------------------------------
// Tests: handlePushSubscribe
// ---------------------------------------------------------------------------

describe("handlePushSubscribe", () => {
  let repo: DrizzlePushSubscriptionRepository;
  const userId = "user-push-test-1";

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await createTestDb();
    await seedUser(db.$client, userId);
    repo = new DrizzlePushSubscriptionRepository(db);
    // Wire the mock so the handler uses our in-memory DB
    vi.mocked(getDb).mockReturnValue(db);
  });

  it("returns 401 when request has no valid session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const req = makeSubscribeRequest({
      endpoint: "https://push.example.com/ep1",
      p256dh: "key-abc",
      auth: "auth-abc",
    });

    const res = await handlePushSubscribe(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect((json as { error: string }).error).toBe("Unauthorized");
  });

  it("returns 400 when required fields are missing", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(makeAuthenticatedSession(userId));

    // Missing p256dh and auth
    const req = makeSubscribeRequest({ endpoint: "https://push.example.com/ep1" });

    const res = await handlePushSubscribe(req);

    expect(res.status).toBe(400);
  });

  it("returns 200 and persists the subscription in the DB (flat body format)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(makeAuthenticatedSession(userId));

    const req = makeSubscribeRequest({
      endpoint: "https://push.example.com/ep1",
      p256dh: "key-p256dh-flat",
      auth: "auth-flat",
    });

    const res = await handlePushSubscribe(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect((json as { ok: boolean }).ok).toBe(true);

    // Assert real persistence — not just the status code
    const stored = await repo.getByUserId(userId);
    expect(stored).not.toBeNull();
    expect(stored!.endpoint).toBe("https://push.example.com/ep1");
    expect(stored!.p256dh).toBe("key-p256dh-flat");
    expect(stored!.auth).toBe("auth-flat");
    expect(stored!.userId).toBe(userId);
  });

  it("returns 200 and persists the subscription using nested keys format", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(makeAuthenticatedSession(userId));

    const req = makeSubscribeRequest({
      endpoint: "https://push.example.com/ep2",
      keys: { p256dh: "key-p256dh-nested", auth: "auth-nested" },
    });

    const res = await handlePushSubscribe(req);

    expect(res.status).toBe(200);

    const stored = await repo.getByUserId(userId);
    expect(stored).not.toBeNull();
    expect(stored!.endpoint).toBe("https://push.example.com/ep2");
    expect(stored!.p256dh).toBe("key-p256dh-nested");
    expect(stored!.auth).toBe("auth-nested");
  });

  it("overwrites an existing subscription when the user subscribes again", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(makeAuthenticatedSession(userId));

    // First subscription
    const req1 = makeSubscribeRequest({
      endpoint: "https://push.example.com/ep-old",
      p256dh: "key-old",
      auth: "auth-old",
    });
    await handlePushSubscribe(req1);

    // Second subscription (update) — same user, different endpoint
    const req2 = makeSubscribeRequest({
      endpoint: "https://push.example.com/ep-new",
      p256dh: "key-new",
      auth: "auth-new",
    });
    const res2 = await handlePushSubscribe(req2);

    expect(res2.status).toBe(200);

    const stored = await repo.getByUserId(userId);
    expect(stored!.endpoint).toBe("https://push.example.com/ep-new");
    expect(stored!.p256dh).toBe("key-new");
  });
});

// ---------------------------------------------------------------------------
// Tests: handlePushUnsubscribe
// ---------------------------------------------------------------------------

describe("handlePushUnsubscribe", () => {
  let repo: DrizzlePushSubscriptionRepository;
  const userId = "user-push-test-2";

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await createTestDb();
    await seedUser(db.$client, userId);
    repo = new DrizzlePushSubscriptionRepository(db);
    vi.mocked(getDb).mockReturnValue(db);
  });

  it("returns 401 when request has no valid session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const req = makeUnsubscribeRequest();
    const res = await handlePushUnsubscribe(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect((json as { error: string }).error).toBe("Unauthorized");
  });

  it("returns 200 and removes the subscription from the DB", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(makeAuthenticatedSession(userId));

    // Pre-seed a subscription for this user directly via the repo
    // (same DB instance as the handler will use via the mock)
    await repo.store({
      id: "sub-to-delete",
      userId,
      endpoint: "https://push.example.com/to-delete",
      p256dh: "key-to-delete",
      auth: "auth-to-delete",
      createdAt: new Date().toISOString(),
    });

    // Verify it exists before calling unsubscribe
    const before = await repo.getByUserId(userId);
    expect(before).not.toBeNull();

    const req = makeUnsubscribeRequest();
    const res = await handlePushUnsubscribe(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect((json as { ok: boolean }).ok).toBe(true);

    // Assert real removal — the subscription must be gone
    const after = await repo.getByUserId(userId);
    expect(after).toBeNull();
  });

  it("returns 200 even when no subscription exists (idempotent unsubscribe)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(makeAuthenticatedSession(userId));

    // No subscription seeded — unsubscribe should still succeed gracefully
    const req = makeUnsubscribeRequest();
    const res = await handlePushUnsubscribe(req);

    expect(res.status).toBe(200);
    const after = await repo.getByUserId(userId);
    expect(after).toBeNull();
  });
});
