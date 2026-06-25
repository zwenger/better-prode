import type { Page, BrowserContext } from "@playwright/test";

/**
 * Auth bypass helper for E2E tests.
 *
 * Seeds a test user in the DB and injects a valid session cookie so tests
 * can skip the Google OAuth redirect flow.
 *
 * Usage:
 *   const { user } = await seedUserAndInjectSession(page, context);
 *   await page.goto("/matches");
 *
 * NOTE: This requires the test DB to be seeded with the fixture user.
 * The server must also expose a test-only endpoint at /api/test/session
 * that mints a valid session for a given user ID (disabled in production
 * via the TEST_AUTH_BYPASS env var guard).
 */

export interface TestUser {
  id: string;
  email: string;
  name: string;
}

export const TEST_USER: TestUser = {
  id: "test-user-e2e-seed",
  email: "test@better-prode.test",
  name: "E2E Test User",
};

/**
 * Injects a session cookie for the given test user into the browser context.
 * The actual session minting logic lives server-side at /api/test/session.
 *
 * @param page    - Playwright Page instance
 * @param context - Playwright BrowserContext instance
 * @param user    - The test user to log in as (defaults to TEST_USER)
 */
export async function seedUserAndInjectSession(
  page: Page,
  context: BrowserContext,
  user: TestUser = TEST_USER
): Promise<{ user: TestUser }> {
  const baseURL =
    process.env["PLAYWRIGHT_BASE_URL"] ?? "http://localhost:3000";

  // Ask the server to mint a session for this test user
  const response = await page.request.post(
    `${baseURL}/api/test/session`,
    {
      data: { userId: user.id, email: user.email, name: user.name },
    }
  );

  if (!response.ok()) {
    throw new Error(
      `Auth bypass failed: POST /api/test/session returned ${response.status()}. ` +
        "Ensure TEST_AUTH_BYPASS=true is set in the server's environment."
    );
  }

  // The server sets a Set-Cookie header — Playwright picks it up automatically
  // via the page request context. We also reflect it into the browser context.
  const cookies = await context.cookies();
  if (!cookies.some((c) => c.name === "better-auth.session_token")) {
    // If the cookie wasn't set automatically, something is wrong
    console.warn(
      "Auth bypass: session cookie was not set automatically. " +
        "Check the /api/test/session implementation."
    );
  }

  return { user };
}
