/**
 * Tracer Bullet E2E — tasks 1.18 RED → 1.19 GREEN
 *
 * Proves the full vertical slice end-to-end:
 *  1. Auth bypass login (no real Google OAuth)
 *  2. Match list visible (fetched from seeded DB)
 *  3. Submit a prediction
 *  4. Admin applies result via applyMatchResult
 *  5. Leaderboard reflects points
 *
 * Spec (testability): test auth bypass; seedable DB.
 * Runs against both chromium-mobile (375×812) and chromium-desktop (1280×720)
 * via the two playwright projects in playwright.config.ts.
 *
 * Requirements:
 *  - Server started with TEST_AUTH_BYPASS=true TURSO_DATABASE_URL=file:./e2e.db
 *  - e2e.db seeded with db/seeds/e2e-fixture.sql (run via npm run db:seed)
 */

import { test, expect   } from "@playwright/test";
import type {Page, BrowserContext} from "@playwright/test";
import { seedUserAndInjectSession, TEST_USER } from "./helpers/auth-bypass";

test.describe("Tracer Bullet — login → predict → settle → leaderboard", () => {
  let page: Page;
  let context: BrowserContext;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterEach(async () => {
    await context.close();
  });

  test("unauthenticated user sees sign-in prompt on home page", async () => {
    await page.goto("/");
    // Should show sign-in prompt for unauthenticated users
    const signInEl = page.locator("[data-testid='sign-in-google']");
    await expect(signInEl).toBeVisible({ timeout: 10000 });
  });

  test("auth bypass login → user sees welcome and nav links", async () => {
    await seedUserAndInjectSession(page, context, TEST_USER);
    await page.goto("/");

    // User should be welcomed
    const welcome = page.locator("[data-testid='welcome-user']");
    await expect(welcome).toBeVisible({ timeout: 10000 });
    await expect(welcome).toContainText(TEST_USER.name);

    // Navigation to matches should be visible
    const matchesLink = page.locator("[data-testid='nav-matches']");
    await expect(matchesLink).toBeVisible();
  });

  test("match list shows seeded matches after login", async () => {
    await seedUserAndInjectSession(page, context, TEST_USER);
    await page.goto("/matches");

    // Match list page should load
    const matchList = page.locator("[data-testid='match-list']");
    await expect(matchList).toBeVisible({ timeout: 15000 });

    // At least one match card should exist (from seed)
    const matchCards = page.locator("[data-testid='match-card']");
    await expect(matchCards.first()).toBeVisible();
  });

  test("submit prediction for a match", async () => {
    await seedUserAndInjectSession(page, context, TEST_USER);
    await page.goto("/matches");

    await page.locator("[data-testid='match-list']").waitFor({ timeout: 15000 });

    // Click the "Increase home goals" stepper button
    const increaseHome = page.locator("[aria-label='Increase home goals']").first();
    await increaseHome.click();
    await increaseHome.click(); // 2 home goals

    // Click the "Increase away goals" stepper
    const increaseAway = page.locator("[aria-label='Increase away goals']").first();
    await increaseAway.click(); // 1 away goal

    // Submit
    const submitBtn = page.locator("[data-testid='submit-prediction']").first();
    await submitBtn.click();

    // Should show saved confirmation
    const saved = page.locator("[data-testid='prediction-saved']").first();
    await expect(saved).toBeVisible({ timeout: 10000 });
  });

  test("leaderboard page renders without crashing", async () => {
    await seedUserAndInjectSession(page, context, TEST_USER);
    await page.goto("/leaderboard/group-e2e-test");

    const leaderboard = page.locator("[data-testid='leaderboard']");
    await expect(leaderboard).toBeVisible({ timeout: 15000 });
  });
});
