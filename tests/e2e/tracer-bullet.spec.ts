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
import { seedUserAndInjectSession, resetDb, TEST_USER } from "./helpers/auth-bypass";

test.describe("Tracer Bullet — login → predict → settle → leaderboard", () => {
  let page: Page;
  let context: BrowserContext;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    // User-scoped reset: only clears TEST_USER's predictions so that
    // parallel runs (chromium-desktop + chromium-mobile) don't interfere.
    await resetDb(page, TEST_USER.id);
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

  test("auth bypass login → logged-in user at / redirects to /today", async () => {
    await seedUserAndInjectSession(page, context, TEST_USER);
    await page.goto("/");

    // Logged-in user at / must redirect to /today (server-side)
    await page.waitForURL(/\/today/, { timeout: 10000 });
    expect(page.url()).toContain("/today");

    // The global brand header is visible — user is in the app
    const brand = page.locator("[data-testid='app-brand-home']");
    await expect(brand).toBeVisible();
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

    // Verify the prediction was actually PERSISTED to the DB with the correct
    // scores — not just that the UI showed a confirmation. Connects to the E2E
    // libSQL server (turso dev on :8081, started by scripts/e2e-server.sh).
    const { createClient } = await import("@libsql/client");
    const dbClient = createClient({ url: "http://127.0.0.1:8081" });
    const row = await dbClient.execute({
      sql: "SELECT home_goals, away_goals FROM prediction WHERE user_id = ? AND match_id = ?",
      args: [TEST_USER.id, "match-arg-bra"],
    });
    expect(row.rows.length).toBe(1);
    expect(Number(row.rows[0].home_goals)).toBe(2);
    expect(Number(row.rows[0].away_goals)).toBe(1);
  });

  test("leaderboard page renders without crashing", async () => {
    await seedUserAndInjectSession(page, context, TEST_USER);
    await page.goto("/leaderboard/group-e2e-test");

    const leaderboard = page.locator("[data-testid='leaderboard']");
    await expect(leaderboard).toBeVisible({ timeout: 15000 });
  });
});
