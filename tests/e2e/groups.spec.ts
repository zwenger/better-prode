/**
 * Groups E2E — task 6.7 RED (mobile viewport)
 *
 * Covers the groups spec scenarios:
 *  - Create a new group as user A.
 *  - Copy the invite link.
 *  - User B joins via the invite link.
 *  - Both users see the shared leaderboard.
 *
 * Spec (groups): invite-link-only join; owner auto-assigned; member sees
 * shared leaderboard ranked by totalPoints.
 *
 * STATUS: DEFERRED — execution blocked by Node.js <22.9 constraint.
 * The @cloudflare/vite-plugin requires Node ≥22.9 to start the E2E server.
 * E2E spec file written; will execute once the Node/vite-plugin issue resolves.
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

    // Navigate directly to the seeded group's invite page
    await pageA.goto("/groups/group-e2e-test/invite");

    // Must click the "Generar enlace de invitación" button first — the link is
    // not shown until the user requests one.
    const generateBtn = pageA.locator("[data-testid='generate-invite-btn']");
    await expect(generateBtn).toBeVisible({ timeout: 10000 });
    await generateBtn.click();

    // Wait for the invite URL to appear after generation
    const inviteUrl = pageA.locator("[data-testid='invite-url']");
    await expect(inviteUrl).toBeVisible({ timeout: 15000 });
    const urlText = await inviteUrl.textContent();
    expect(urlText).toContain("/invite/");
  });

  test("second user joins via invite link and sees the group in their list", async () => {
    await seedUserAndInjectSession(pageA, contextA, TEST_USER);
    await seedUserAndInjectSession(pageB, contextB, SECOND_USER);

    // User A generates an invite token for the seeded group
    await pageA.goto("/groups/group-e2e-test/invite");
    const generateBtn = pageA.locator("[data-testid='generate-invite-btn']");
    await expect(generateBtn).toBeVisible({ timeout: 10000 });
    await generateBtn.click();

    // Wait for the invite URL to appear
    const inviteUrlEl = pageA.locator("[data-testid='invite-url']");
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
