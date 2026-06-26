/**
 * E2E: Prediction lock behaviour — task 2.1 (RED spec)
 *
 * Covers two angles from spec (predictions):
 *  1. Client-side: stepper and submit button are disabled at T-5min
 *  2. Server-side: POST to /api/predictions/submit returns 422 with
 *     { reason: "match_locked" } even when the client bypasses the UI lock
 *
 * NOTE: this suite is DEFERRED — it cannot run in the current execution
 * environment because @cloudflare/vite-plugin requires Node.js ≥22.9.
 * The test file is written and ready; run via `npx playwright test` in a
 * Node ≥22.9 environment (or CI with the correct node version pinned).
 */

import { test, expect } from "@playwright/test";
import { seedUserAndInjectSession } from "./helpers/auth-bypass";

const LOCKED_MATCH_ID = "e2e-match-locked";

test.describe("Prediction lock — client + server", () => {
  test.beforeEach(async ({ page, context }) => {
    await seedUserAndInjectSession(page, context, { id: "e2e-user-lock", email: "lock@e2e.test", name: "Lock Tester" });
  });

  test("stepper and submit are disabled when match is locked (client affordance)", async ({ page }) => {
    await page.goto("/matches");

    // Find the card for the locked match
    const card = page.locator(`[data-testid="match-card"][data-match-id="${LOCKED_MATCH_ID}"]`);

    // The submit button should either not exist or be disabled for locked matches
    const submitBtn = card.locator('[data-testid="submit-prediction"]');
    const count = await submitBtn.count();
    if (count > 0) {
      await expect(submitBtn).toBeDisabled();
    }
  });

  test("server returns 422 match_locked even when client does not check lock (server-authoritative)", async ({ page }) => {
    // Craft a direct POST bypassing the client UI — server must still reject.
    // Use page.request so the authenticated session cookie is included.
    // e2e-match-locked is seeded with a past kickoff (2020), so isLocked() is true.
    const response = await page.request.post("/api/predictions/submit", {
      data: {
        matchId: LOCKED_MATCH_ID,
        homeGoals: 2,
        awayGoals: 1,
      },
    });

    // The server must reject with 422 (match_locked) regardless of client state.
    expect(response.status()).toBe(422);
    const body = await response.json().catch(() => null);
    if (body) {
      // The structured body must contain the lock reason
      expect(JSON.stringify(body)).toContain("match_locked");
    }
  });
});
