/**
 * POST /api/test/session
 *
 * Test-only endpoint: mints a Better Auth session for a given user ID.
 * Used by the Playwright E2E auth-bypass helper to skip Google OAuth.
 *
 * Uses the testAuth instance (includes testUtils plugin) to create a real
 * session token via internalAdapter.createSession. Returns the session token
 * and a Set-Cookie header value so Playwright can inject the auth cookie into
 * the browser context directly without performing OAuth.
 *
 * SECURITY: Only available when TEST_AUTH_BYPASS=true.
 * This endpoint MUST NOT be deployed to production.
 *
 * Registration: handled in src/server-entry.ts, which intercepts
 * POST /api/test/session before TanStack Start's router.
 * TanStack Start v1 does not have createAPIFileRoute; raw HTTP endpoints
 * must be intercepted at the Cloudflare Worker fetch handler level.
 *
 * Spec (testability): test auth bypass for Playwright E2E.
 */

import { getDbClient } from "#/infra/db/client";
import { testAuth } from "#/infra/auth/auth-test";

export interface TestSessionInput {
  userId: string;
  email: string;
  name: string;
}

/** A single cookie as returned by Better Auth's testUtils.getCookies(). */
interface TestCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  expires?: number | undefined;
}

/**
 * Raw HTTP handler for POST /api/test/session.
 * Called by the Worker entry in src/server-entry.ts.
 *
 * SECURITY: Only available when TEST_AUTH_BYPASS=true.
 * This function MUST NOT be deployed to production.
 */
export async function handleTestSession(request: Request): Promise<Response> {
  if (process.env["TEST_AUTH_BYPASS"] !== "true") {
    return Response.json(
      { error: "Test auth bypass is not enabled" },
      { status: 403 }
    );
  }

  let body: TestSessionInput;
  try {
    const raw: unknown = await request.json();
    body = raw as TestSessionInput;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.userId || !body.email || !body.name) {
    return Response.json(
      { error: "Missing required fields: userId, email, name" },
      { status: 400 }
    );
  }

  const db = getDbClient();
  const now = new Date().toISOString();

  // Upsert test user into our user table so Better Auth can create a session.
  await db.execute({
    sql: `INSERT INTO "user"(id, email, name, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name`,
    args: [body.userId, body.email, body.name, now],
  });

  // Use testAuth (which includes testUtils plugin) to create a real session.
  // test.login() calls internalAdapter.createSession() and returns:
  //   - token: the raw session token string
  //   - headers: Headers with "cookie" header (NOT Set-Cookie — this is for
  //              server-side request simulation, not browser injection)
  //   - cookies: TestCookie[] with signed cookie value and all attributes —
  //              USE THIS to build the Set-Cookie header for Playwright
  const ctx = await testAuth.$context;
  const result = await (
    ctx as {
      test: {
        login: (opts: { userId: string }) => Promise<{
          headers: Headers;
          token: string;
          cookies: TestCookie[];
        }>;
      };
    }
  ).test.login({
    userId: body.userId,
  });

  // Build Set-Cookie header from the TestCookie object returned by testUtils.
  // Better Auth's createCookieHeaders() sets "cookie" (for server-side use),
  // not "Set-Cookie" (for browser injection). We use the cookies[] array
  // which has the signed token value and all cookie attributes.
  const sessionCookies = result.cookies;
  let setCookieHeader: string | undefined;

  if (sessionCookies.length > 0) {
    // Build the Set-Cookie header string from the cookie attributes.
    // Better Auth's createCookieHeaders() sets a "cookie" request header
    // (for server-side use), NOT "Set-Cookie". We use the cookies[] array
    // (from createTestCookie) which has the signed token and all attributes.
    const c = sessionCookies[0];
    let cookieStr = `${c.name}=${c.value}`;
    if (c.path) cookieStr += `; Path=${c.path}`;
    if (c.httpOnly) cookieStr += `; HttpOnly`;
    if (c.secure) cookieStr += `; Secure`;
    if (c.sameSite) cookieStr += `; SameSite=${c.sameSite}`;
    if (c.expires) {
      cookieStr += `; Expires=${new Date(c.expires * 1000).toUTCString()}`;
    }
    setCookieHeader = cookieStr;
  }

  return Response.json(
    { success: true, sessionToken: result.token, setCookieHeader },
    {
      status: 200,
      headers: setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined,
    }
  );
}
