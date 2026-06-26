import type { Page, BrowserContext, Page as PlaywrightPage } from "@playwright/test";

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

export const ADMIN_USER: TestUser = {
  id: "test-admin-e2e-seed",
  email: "admin@better-prode.test",
  name: "E2E Admin User",
};

/**
 * Dedicated users for match-views tests — one per Playwright project — so that
 * parallel runs (chromium-desktop + chromium-mobile) don't race on the same
 * user's predictions. Each user has a unique ID that maps to a project.
 */
export const MATCH_VIEWS_USER_DESKTOP: TestUser = {
  id: "test-user-mv-desktop",
  email: "mv-desktop@better-prode.test",
  name: "Match Views Desktop",
};

export const MATCH_VIEWS_USER_MOBILE: TestUser = {
  id: "test-user-mv-mobile",
  email: "mv-mobile@better-prode.test",
  name: "Match Views Mobile",
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
    process.env["PLAYWRIGHT_BASE_URL"] ?? "http://localhost:4173";

  // Ask the server to mint a session for this test user.
  // The server upserts the user in the DB and returns a session token
  // plus the Set-Cookie header to inject into the browser.
  const response = await page.request.post(`${baseURL}/api/test/session`, {
    data: { userId: user.id, email: user.email, name: user.name },
  });

  if (!response.ok()) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(
      `Auth bypass failed: POST /api/test/session returned ${response.status()}.\n` +
        `Body: ${body}\n` +
        "Ensure TEST_AUTH_BYPASS=true is set in the server's environment."
    );
  }

  const data = await response.json();

  // If the server returned a Set-Cookie header, inject it into the browser context.
  if (data.setCookieHeader) {
    // Parse the Set-Cookie header to extract name, value, and attributes.
    const [nameValue, ...attributes] = data.setCookieHeader.split(";");
    const eqIdx = nameValue.indexOf("=");
    const cookieName = nameValue.slice(0, eqIdx).trim();
    const cookieValue = nameValue.slice(eqIdx + 1).trim();

    // Build the domain from baseURL (localhost for local dev).
    const url = new URL(baseURL);
    const domain = url.hostname;

    // Parse attributes into a cookie object for Playwright.
    const attrMap: Record<string, string> = {};
    for (const attr of attributes) {
      const [k, v] = attr.split("=").map((s: string) => s.trim());
      attrMap[k.toLowerCase()] = v ?? "true";
    }

    await context.addCookies([
      {
        name: cookieName,
        value: cookieValue,
        domain,
        path: attrMap["path"] ?? "/",
        httpOnly: "httponly" in attrMap,
        secure: "secure" in attrMap,
        sameSite: (attrMap["samesite"] as ("Lax" | "Strict" | "None") | undefined) ?? "Lax",
      },
    ]);
  } else {
    // Fallback: check if the cookie was set automatically via the request context.
    const cookies = await context.cookies();
    if (!cookies.some((c) => c.name === "better-auth.session_token")) {
      console.warn(
        "Auth bypass: session cookie was not set automatically. " +
          "Check the /api/test/session implementation."
      );
    }
  }

  return { user };
}

/**
 * Resets volatile DB tables (prediction, push_subscription, invitation)
 * via the test-only /api/test/reset-db endpoint.
 *
 * When `userId` is provided, only clears volatile data for that user — safe for
 * parallel test runs (chromium-desktop + chromium-mobile running simultaneously).
 * When omitted, performs a global reset (all rows in volatile tables).
 *
 * Call in beforeEach for tests that submit predictions or manipulate
 * subscriptions/invitations so each test starts from a known clean state.
 *
 * Requires TEST_AUTH_BYPASS=true in the server environment (E2E builds only).
 */
export async function resetDb(page: PlaywrightPage, userId?: string): Promise<void> {
  const baseURL =
    process.env["PLAYWRIGHT_BASE_URL"] ?? "http://localhost:4173";

  const body = userId ? { userId } : undefined;
  const response = await page.request.post(`${baseURL}/api/test/reset-db`, {
    data: body,
  });
  if (!response.ok()) {
    const text = await response.text().catch(() => "(unreadable)");
    console.warn(
      `DB reset warning: POST /api/test/reset-db returned ${response.status()}.\n` +
        `Body: ${text}\n` +
        "Tests may be affected by data from prior test runs."
    );
  }
}
