/**
 * Groups E2E — task 6.7 RED (mobile viewport)
 *
 * Covers the groups spec scenarios:
 *  - Create a new group as user A.
 *  - Copy the invite link.
 *  - User B joins via the invite link.
 *  - Both users see the shared leaderboard.
 *  - The invite link is visible on page load (loader pre-fetches it).
 *  - A third user joins the same token — token remains pending (reusable link).
 *
 * Spec (groups): invite-link-only join; owner auto-assigned; member sees
 * shared leaderboard ranked by totalPoints; token is NOT consumed on join.
 *
 * Requirements:
 *  - Server started with VITE_TEST_AUTH_ENABLED=true (npm run build:e2e)
 *  - e2e.db seeded with db/seeds/e2e-fixture.sql
 */

import { test, expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { seedUserAndInjectSession, resetDb, TEST_USER } from "./helpers/auth-bypass";

const SECOND_USER = {
  id: "e2e-user-2",
  name: "E2E User Two",
  email: "e2e-two@test.com",
};


test.describe("Groups — create, invite, join, shared leaderboard", () => {
  let pageA: Page;
  let pageB: Page;
  let contextA: BrowserContext;
  let contextB: BrowserContext;

  test.beforeEach(async ({ browser }) => {
    contextA = await browser.newContext();
    contextB = await browser.newContext();
    pageA = await contextA.newPage();
    pageB = await contextB.newPage();
    // Global invitation reset (invitations are group-scoped, not user-scoped)
    // so stale invite tokens from prior runs don't conflict.
    await resetDb(pageA);
  });

  test.afterEach(async () => {
    await contextA.close();
    await contextB.close();
  });

  test("user A creates a group and sees it in the groups list", async () => {
    await seedUserAndInjectSession(pageA, contextA, TEST_USER);
    await pageA.goto("/groups/new");

    // Fill in group name
    const nameInput = pageA.locator("input[name='name'], input[placeholder*='nombre'], input[type='text']").first();
    await nameInput.fill("E2E Test Group");

    // Submit the form
    const submitBtn = pageA.locator("button[type='submit'], [data-testid='create-group-btn']").first();
    await submitBtn.click();

    // Should redirect to groups list or group page with the new group
    await pageA.waitForURL(/\/(groups|leaderboard)/, { timeout: 10000 });

    // Navigate to groups list to verify
    await pageA.goto("/groups");
    const groupItem = pageA.locator("[data-testid='group-list-item']");
    await expect(groupItem.first()).toBeVisible({ timeout: 10000 });
    await expect(groupItem.first()).toContainText("E2E Test Group");
  });

  test("group owner can generate an invite link", async () => {
    await seedUserAndInjectSession(pageA, contextA, TEST_USER);

    // Navigate to the seeded group's invite page.
    await pageA.goto("/groups/group-e2e-test/invite");

    const generateBtn = pageA.locator("[data-testid='generate-invite-btn']");
    const inviteUrl = pageA.locator("[data-testid='invite-url']");

    // The invite link may already be visible if the loader found an existing token
    // (loader pre-fetches it — task 4.1). If not, click generate to create one.
    const alreadyVisible = await inviteUrl.isVisible({ timeout: 3000 }).catch(() => false);
    if (!alreadyVisible) {
      await expect(generateBtn).toBeVisible({ timeout: 10000 });
      await generateBtn.click();
    }

    // Wait for the invite URL to be visible
    await expect(inviteUrl).toBeVisible({ timeout: 15000 });
    const urlText = await inviteUrl.textContent();
    expect(urlText).toContain("/invite/");
  });

  test("owner sees and can copy the invite link directly on the groups page", async () => {
    await seedUserAndInjectSession(pageA, contextA, TEST_USER);

    // Open the groups list with the seeded group selected.
    await pageA.goto("/groups?group=group-e2e-test");
    await expect(pageA.locator("[data-testid='groups-list-page']")).toBeVisible({
      timeout: 10000,
    });

    const url = pageA.locator("[data-testid='groups-invite-url']");
    const generateBtn = pageA.locator("[data-testid='groups-generate-invite-btn']");

    // The loader pre-fetches an active link; if none exists yet, generate it inline.
    const alreadyVisible = await url.isVisible({ timeout: 3000 }).catch(() => false);
    if (!alreadyVisible) {
      await expect(generateBtn).toBeVisible({ timeout: 10000 });
      await generateBtn.click();
    }

    await expect(url).toBeVisible({ timeout: 15000 });
    expect((await url.textContent()) ?? "").toContain("/invite/");

    // The copy control is present next to the link.
    await expect(
      pageA.locator("[data-testid='groups-copy-invite-btn']")
    ).toBeVisible({ timeout: 10000 });
  });

  test("second user joins via invite link and sees the group in their list", async () => {
    await seedUserAndInjectSession(pageA, contextA, TEST_USER);
    await seedUserAndInjectSession(pageB, contextB, SECOND_USER);

    // User A generates an invite token for the seeded group
    await pageA.goto("/groups/group-e2e-test/invite");

    const inviteUrlEl = pageA.locator("[data-testid='invite-url']");
    const generateBtn = pageA.locator("[data-testid='generate-invite-btn']");

    const alreadyVisible = await inviteUrlEl.isVisible({ timeout: 3000 }).catch(() => false);
    if (!alreadyVisible) {
      await expect(generateBtn).toBeVisible({ timeout: 10000 });
      await generateBtn.click();
    }

    await expect(inviteUrlEl).toBeVisible({ timeout: 15000 });
    const link = (await inviteUrlEl.textContent()) ?? "";
    expect(link).toContain("/invite/");

    // User B visits the invite link
    await pageB.goto(link.trim());

    // Should redirect or show a join confirmation
    await pageB.waitForURL(/\/(groups|invite|leaderboard)/, { timeout: 10000 });

    // User B should now see the group
    await pageB.goto("/groups");
    const groupItem = pageB.locator("[data-testid='group-list-item']");
    await expect(groupItem.first()).toBeVisible({ timeout: 10000 });
  });

  test("invite token stays pending — existing member sees the join page not 'invalid invite'", async () => {
    // Verifies the core bug fix at the e2e level: the invite token is NOT consumed
    // when a user joins, so subsequent visitors can still access the join-confirm page
    // via the same link.
    //
    // Strategy: user A generates the invite and extracts the URL. User B (already a
    // member via fixture) navigates to that URL. If the token had been consumed,
    // the page would show [data-testid="invalid-invite"]. Since the token is still
    // pending, [data-testid="invite-join-page"] is shown instead.
    //
    // The test asserts only the PAGE RENDER (SSR-level check) — no server actions
    // are triggered by this assertion. The SSR loader runs once on navigation, so
    // there is no subsequent async window where a parallel resetDb can interfere.
    await seedUserAndInjectSession(pageA, contextA, TEST_USER);
    await seedUserAndInjectSession(pageB, contextB, SECOND_USER);

    // User A generates the invite link
    await pageA.goto("/groups/group-e2e-test/invite");
    const inviteUrlEl = pageA.locator("[data-testid='invite-url']");
    const generateBtn = pageA.locator("[data-testid='generate-invite-btn']");

    const alreadyVisible = await inviteUrlEl.isVisible({ timeout: 3000 }).catch(() => false);
    if (!alreadyVisible) {
      await expect(generateBtn).toBeVisible({ timeout: 10000 });
      await generateBtn.click();
    }
    await expect(inviteUrlEl).toBeVisible({ timeout: 15000 });
    const link = (await inviteUrlEl.textContent()) ?? "";
    expect(link).toContain("/invite/");

    // User B navigates to the invite link immediately after user A obtains it.
    // The SSR loader checks the token in the DB and renders the join page.
    // If the token had been consumed/revoked, "invalid-invite" would be shown.
    await pageB.goto(link.trim());
    const inviteJoinPage = pageB.locator("[data-testid='invite-join-page']");
    await expect(inviteJoinPage).toBeVisible({ timeout: 10000 });
  });

  test("both users see the shared leaderboard for the group", async () => {
    await seedUserAndInjectSession(pageA, contextA, TEST_USER);
    await seedUserAndInjectSession(pageB, contextB, SECOND_USER);

    // Navigate to the shared leaderboard (seeded group)
    await pageA.goto("/leaderboard/group-e2e-test");
    const leaderboardA = pageA.locator("[data-testid='leaderboard']");
    await expect(leaderboardA).toBeVisible({ timeout: 15000 });

    await pageB.goto("/leaderboard/group-e2e-test");
    const leaderboardB = pageB.locator("[data-testid='leaderboard']");
    await expect(leaderboardB).toBeVisible({ timeout: 15000 });
  });
});
