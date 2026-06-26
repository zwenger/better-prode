/**
 * TDD 5.1 (RED): Push subscription adapter tests.
 *
 * Spec (reminders):
 *  - Store a push subscription linked to a user
 *  - Fetch users who have NOT yet predicted for a given match (non-predictors)
 *    and have an active push subscription
 *  - Send a Web Push notification to a subscription endpoint
 *  - Handle 410 Gone response: delete the stale subscription and do not retry
 *
 * Strategy: we use an InMemoryPushSubscriptionRepository for the storage tests
 * and a fake Web Push sender that records calls + can simulate 410 Gone.
 * The integration adapter (DrizzlePushSubscriptionRepository) is not unit-tested
 * here because it requires a DB — covered by integration tests in a separate file.
 *
 * The push-send path is fully abstracted behind a PushSender port so the real
 * web-push library is swapped for a fake in tests.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type {
  PushSubscriptionRecord,
  PushSender,
  PushPayload,
} from "./push-subscription";
import {
  InMemoryPushSubscriptionRepository,
  sendReminderToNonPredictors,
} from "./push-subscription";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUB_A: PushSubscriptionRecord = {
  id: "sub-a",
  userId: "user-1",
  endpoint: "https://push.example.com/sub-a",
  p256dh: "key-p256dh-a",
  auth: "auth-a",
  createdAt: new Date().toISOString(),
};

const SUB_B: PushSubscriptionRecord = {
  id: "sub-b",
  userId: "user-2",
  endpoint: "https://push.example.com/sub-b",
  p256dh: "key-p256dh-b",
  auth: "auth-b",
  createdAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// InMemoryPushSubscriptionRepository tests
// ---------------------------------------------------------------------------

describe("InMemoryPushSubscriptionRepository", () => {
  let repo: InMemoryPushSubscriptionRepository;

  beforeEach(() => {
    repo = new InMemoryPushSubscriptionRepository();
  });

  it("store persists a subscription and getByUserId returns it", async () => {
    await repo.store(SUB_A);
    const result = await repo.getByUserId(SUB_A.userId);
    expect(result).not.toBeNull();
    expect(result?.endpoint).toBe(SUB_A.endpoint);
  });

  it("getByUserId returns null when no subscription exists for user", async () => {
    const result = await repo.getByUserId("no-such-user");
    expect(result).toBeNull();
  });

  it("store overwrites an existing subscription for the same user", async () => {
    const updated: PushSubscriptionRecord = {
      ...SUB_A,
      endpoint: "https://push.example.com/updated",
    };
    await repo.store(SUB_A);
    await repo.store(updated);
    const result = await repo.getByUserId(SUB_A.userId);
    expect(result?.endpoint).toBe("https://push.example.com/updated");
  });

  it("delete removes the subscription so subsequent getByUserId returns null", async () => {
    await repo.store(SUB_A);
    await repo.deleteByUserId(SUB_A.userId);
    const result = await repo.getByUserId(SUB_A.userId);
    expect(result).toBeNull();
  });

  it("listByUserIds returns only subscriptions for the requested user IDs", async () => {
    await repo.store(SUB_A);
    await repo.store(SUB_B);
    const results = await repo.listByUserIds([SUB_A.userId]);
    expect(results).toHaveLength(1);
    expect(results[0].userId).toBe(SUB_A.userId);
  });

  it("listByUserIds returns empty array when no users have subscriptions", async () => {
    const results = await repo.listByUserIds(["user-no-sub"]);
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// sendReminderToNonPredictors orchestration tests
// ---------------------------------------------------------------------------

describe("sendReminderToNonPredictors", () => {
  let repo: InMemoryPushSubscriptionRepository;
  let fakeSender: PushSender & { calls: Array<{ sub: PushSubscriptionRecord; payload: PushPayload }> };

  beforeEach(() => {
    repo = new InMemoryPushSubscriptionRepository();

    fakeSender = {
      calls: [],
      async send(sub, payload) {
        this.calls.push({ sub, payload });
      },
    };
  });

  it("sends push only to non-predictors who have a subscription", async () => {
    // user-1 has subscription and has NOT predicted
    // user-2 has subscription but HAS predicted
    // user-3 has NOT predicted and has NO subscription
    await repo.store(SUB_A); // user-1
    await repo.store(SUB_B); // user-2

    const allGroupUserIds: string[] = ["user-1", "user-2", "user-3"];
    const predictorUserIds: string[] = ["user-2"]; // user-2 has already predicted

    await sendReminderToNonPredictors({
      allGroupUserIds,
      predictorUserIds,
      matchId: "match-1",
      subscriptionRepo: repo,
      sender: fakeSender,
    });

    // Only user-1 should receive a push (non-predictor + has subscription)
    expect(fakeSender.calls).toHaveLength(1);
    expect(fakeSender.calls[0].sub.userId).toBe("user-1");
  });

  it("skips users who have already predicted", async () => {
    await repo.store(SUB_A); // user-1

    const allGroupUserIds: string[] = ["user-1"];
    const predictorUserIds: string[] = ["user-1"]; // user-1 has predicted

    await sendReminderToNonPredictors({
      allGroupUserIds,
      predictorUserIds,
      matchId: "match-1",
      subscriptionRepo: repo,
      sender: fakeSender,
    });

    expect(fakeSender.calls).toHaveLength(0);
  });

  it("skips users with no push subscription (silent, no error)", async () => {
    // user-1 has no subscription

    const allGroupUserIds: string[] = ["user-1"];
    const predictorUserIds: string[] = [];

    await sendReminderToNonPredictors({
      allGroupUserIds,
      predictorUserIds,
      matchId: "match-1",
      subscriptionRepo: repo,
      sender: fakeSender,
    });

    expect(fakeSender.calls).toHaveLength(0);
  });

  it("deletes subscription on 410 Gone and does not retry", async () => {
    await repo.store(SUB_A); // user-1

    let callCount = 0;
    const goneSender: PushSender = {
      async send(_sub, _payload) {
        callCount++;
        const err = new Error("Gone");
        (err as Error & { statusCode?: number }).statusCode = 410;
        throw err;
      },
    };

    const allGroupUserIds: string[] = ["user-1"];
    const predictorUserIds: string[] = [];

    // Should not throw — 410 is handled gracefully
    await expect(
      sendReminderToNonPredictors({
        allGroupUserIds,
        predictorUserIds,
        matchId: "match-1",
        subscriptionRepo: repo,
        sender: goneSender,
      })
    ).resolves.not.toThrow();

    // Subscription should be deleted after 410
    const remaining = await repo.getByUserId(SUB_A.userId);
    expect(remaining).toBeNull();

    // Send was called exactly once (no retry)
    expect(callCount).toBe(1);
  });
});
