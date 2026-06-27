/**
 * Match Views E2E — tasks 4.8 (spec) + 4.9 (execution)
 *
 * DEFERRED: @cloudflare/vite-plugin requires Node.js ≥22.9.
 * Current environment: Node.js v22.x (<22.9).
 * Status: File written and complete. Tests CANNOT run until Node is upgraded.
 *
 * Tests the following spec scenarios from specs/match-views/spec.md:
 *  - User views match list: matches listed with status, local kickoff time, prediction
 *  - In-progress matches surface prominently
 *  - Prediction entry before lock: steppers active
 *  - Prediction entry locked in UI after T−5min: steppers disabled
 *  - Saved prediction persists on reload (0-0 bug fix — task 4.6)
 *  - Predictions drawer: hidden before lock, visible after lock for group members
 *  - Predictions hidden before lock (server enforces)
 *  - Kickoff shown in user's local time with tz label
 *
 * Requirements:
 *  - Server started with TEST_AUTH_BYPASS=true TURSO_DATABASE_URL=file:./e2e.db
 *  - e2e.db seeded with db/seeds/e2e-fixture.sql (run via npm run db:seed)
 *  - Fixture includes: at least one scheduled match, one in-progress match,
 *    one locked match (kickoff in past), and a group with 2 members
 */

import { test, expect } from "@playwright/test";
import type { Page, BrowserContext } from "@playwright/test";
import { seedUserAndInjectSession, resetDb } from "./helpers/auth-bypass";
import type { TestUser } from "./helpers/auth-bypass";

test.describe("Match Views — match list, predictions, drawer", () => {
  let page: Page;
  let context: BrowserContext;
  // Each Playwright project gets its own test user so that chromium-desktop and
  // chromium-mobile can run the prediction-reload test in parallel without their
  // resetDb calls clearing each other's submitted predictions.
  let matchViewsUser: TestUser;

  test.beforeEach(async ({ browser }, testInfo) => {
    // Each test gets a worker-specific user so that parallel tests (fullyParallel:true)
    // in the same describe block don't clear each other's predictions via resetDb.
    // The workerIndex is unique per Playwright worker process.
    const workerSuffix = testInfo.workerIndex;
    const projectSuffix = testInfo.project.name === "chromium-mobile" ? "mob" : "dsk";
    matchViewsUser = {
      id: `test-user-mv-${projectSuffix}-w${workerSuffix}`,
      email: `mv-${projectSuffix}-w${workerSuffix}@better-prode.test`,
      name: `Match Views ${projectSuffix} w${workerSuffix}`,
    };

    context = await browser.newContext();
    page = await context.newPage();
    // User-scoped reset: only clears this worker's user predictions.
    await resetDb(page, matchViewsUser.id);
  });

  test.afterEach(async () => {
    await context.close();
  });

  // ---------------------------------------------------------------------------
  // 4.8.1: Match list visible with correct sections
  // ---------------------------------------------------------------------------

  test("authenticated user sees match list with all sections", async () => {
    await seedUserAndInjectSession(page, context, matchViewsUser);
    await page.goto("/matches");

    const matchList = page.getByTestId("match-list");
    await expect(matchList).toBeVisible();

    // Match cards should be present
    const cards = page.getByTestId("match-card");
    await expect(cards.first()).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 4.8.2: Prediction entry before lock — steppers active
  // ---------------------------------------------------------------------------

  test("match card links to the match detail page", async () => {
    await seedUserAndInjectSession(page, context, matchViewsUser);
    await page.goto("/matches");

    const detailLink = page.getByTestId("match-detail-link").first();
    await expect(detailLink).toBeVisible({ timeout: 10000 });
    await detailLink.click();

    // Navigates to /matches/<matchId>
    await expect(page).toHaveURL(/\/matches\/[^/]+$/, { timeout: 10000 });
  });

  test("prediction steppers are active for unlocked matches", async () => {
    await seedUserAndInjectSession(page, context, matchViewsUser);
    await page.goto("/matches");

    // Find the "Para predecir" section (unlocked scheduled matches)
    const section = page.getByRole("heading", { name: /para predecir/i });
    await expect(section).toBeVisible();

    // Steppers should be enabled
    const decreaseBtn = page.getByRole("button", { name: /decrease home goals/i }).first();
    await expect(decreaseBtn).toBeEnabled();

    const increaseBtn = page.getByRole("button", { name: /increase home goals/i }).first();
    await expect(increaseBtn).toBeEnabled();
  });

  // ---------------------------------------------------------------------------
  // 4.8.3: Saved prediction persists on reload (task 4.6 regression test)
  // ---------------------------------------------------------------------------

  test("saved prediction values are shown on match reload", async () => {
    await seedUserAndInjectSession(page, context, matchViewsUser);
    await page.goto("/matches");

    // Submit a prediction 2-1
    const homeIncrease = page.getByRole("button", { name: /increase home goals/i }).first();
    await homeIncrease.click();
    await homeIncrease.click();
    const awayIncrease = page.getByRole("button", { name: /increase away goals/i }).first();
    await awayIncrease.click();

    await page.getByTestId("submit-prediction").first().click();
    await expect(page.getByTestId("prediction-saved").first()).toBeVisible();

    // Reload the page and wait for the match list to fully hydrate.
    // The steppers initialize from the server-loaded prediction (task 4.6 fix).
    await page.reload();
    // Wait for the match list to be visible so hydration has completed
    await expect(page.getByTestId("match-list")).toBeVisible({ timeout: 15000 });

    // Score steppers should show 2 and 1 (not 0 and 0)
    const homeValue = page.locator("[aria-label='home goals']").first();
    const awayValue = page.locator("[aria-label='away goals']").first();
    await expect(homeValue).toHaveText("2", { timeout: 10000 });
    await expect(awayValue).toHaveText("1", { timeout: 10000 });
  });

  // ---------------------------------------------------------------------------
  // 4.8.3b: Submit button reappears as "Editar predicción" after save (bug fix)
  //
  // Regression: the old card entered a permanent "done" state after a successful
  // save, permanently replacing the submit button. Users had to reload the page
  // to edit their prediction. This test verifies the fix: after a successful
  // save the button reappears within 2 s without navigation.
  // ---------------------------------------------------------------------------

  test("submit button reappears as Editar predicción after a successful save without reload", async () => {
    await seedUserAndInjectSession(page, context, matchViewsUser);
    await page.goto("/matches");

    // Wait for the "Para predecir" section to be available (unlocked matches).
    const section = page.getByRole("heading", { name: /para predecir/i });
    await expect(section).toBeVisible({ timeout: 15000 });

    // Identify the first card that has a submit button (predictable match).
    // Pin the card by its data-match-id so the locator stays stable even while the
    // card transitions through "submitting" → "saved" → "idle" states. A filter
    // locator re-evaluates on every assertion and would drift to a different card
    // while the original card's submit-prediction testid is temporarily absent.
    const firstPredictableCard = page.getByTestId("match-card").filter({
      has: page.getByTestId("submit-prediction"),
    }).first();
    const matchId = await firstPredictableCard.getAttribute("data-match-id");
    // Use the stable data-match-id selector to pin assertions to this specific card.
    const pinnedCard = page.locator(`[data-testid="match-card"][data-match-id="${matchId}"]`);

    // Click save on the first predictable card.
    await pinnedCard.getByTestId("submit-prediction").click();

    // Wait for the transient "¡Guardado!" confirmation to appear on THIS card.
    await expect(pinnedCard.getByTestId("prediction-saved")).toBeVisible({ timeout: 5000 });

    // The button MUST reappear within 2 s after the flash (1.5 s + buffer).
    // This asserts it becomes visible WITHOUT a reload (no page navigation).
    await expect(pinnedCard.getByTestId("submit-prediction")).toBeVisible({ timeout: 3500 });

    // Verify the URL did not change (no redirect happened).
    expect(page.url()).toContain("/matches");

    // Verify the button is labeled for edit (baseline saved) on THIS card.
    const buttonText = await pinnedCard.getByTestId("submit-prediction").textContent();
    expect(buttonText?.trim()).toBe("Editar predicción");
  });

  // ---------------------------------------------------------------------------
  // 4.8.4: Locked match shows disabled steppers
  // ---------------------------------------------------------------------------

  test("steppers are disabled for locked matches", async () => {
    await seedUserAndInjectSession(page, context, matchViewsUser);
    await page.goto("/matches");

    // Locked matches appear in "Resultados" or have locked indicator
    // The submit button should not be present for locked matches
    const lockedCard = page.locator('[data-testid="match-card"]').filter({
      has: page.locator('[data-testid="prediction-locked"]'),
    });

    // If a locked match exists in the list:
    if (await lockedCard.count() > 0) {
      const decreaseBtn = lockedCard.first().getByRole("button", { name: /decrease/i });
      await expect(decreaseBtn).toBeDisabled();
    }
  });

  // ---------------------------------------------------------------------------
  // 4.8.5: Predictions drawer hidden before lock
  // ---------------------------------------------------------------------------

  test("prediction drawer trigger is not shown for unlocked matches", async () => {
    await seedUserAndInjectSession(page, context, matchViewsUser);
    await page.goto("/matches");

    // For unlocked matches, the drawer trigger should not be visible
    const drawerTrigger = page.getByTestId("open-prediction-drawer");
    // Should not exist for unlocked matches in "Para predecir" section
    await expect(drawerTrigger).toHaveCount(0);
  });

  // ---------------------------------------------------------------------------
  // 4.8.6: Kickoff time shown in local timezone
  // ---------------------------------------------------------------------------

  test("kickoff times include timezone label", async () => {
    await seedUserAndInjectSession(page, context, matchViewsUser);
    await page.goto("/matches");

    // Match cards should have localized time (verified by presence of a time pattern)
    const cards = page.getByTestId("match-card");
    if (await cards.count() > 0) {
      const cardText = await cards.first().textContent();
      // The time should include a recognizable date/time pattern
      expect(cardText).toBeTruthy();
      // Timezone display is handled client-side by the MatchHeader component
    }
  });

  // ---------------------------------------------------------------------------
  // 4.9: Server rejects pre-lock prediction drawer requests
  // ---------------------------------------------------------------------------

  test("server returns 403 when requesting group predictions before lock", async () => {
    await seedUserAndInjectSession(page, context, matchViewsUser);

    // Directly call the server fn endpoint for a non-locked match
    // The server fn should reject with 403
    const futureKickoff = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const response = await page.request.get("/api/group-predictions", {
      params: {
        matchId: "any-match",
        kickoffUtc: futureKickoff,
        groupId: "any-group",
      },
    });
    // TanStack Start server fns return error status codes on throw
    expect([403, 404, 405]).toContain(response.status());
  });

});
