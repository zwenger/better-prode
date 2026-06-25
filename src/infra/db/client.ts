import { createClient  } from "@libsql/client";
import type {Client} from "@libsql/client";

/**
 * Creates a libSQL/Turso client from environment variables.
 *
 * Production: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
 * Local dev:  TURSO_DATABASE_URL=file:./local.db (token optional)
 * Tests:      TURSO_DATABASE_URL=:memory: (no token needed)
 */
export function createDbClient(): Client {
  const url = process.env["TURSO_DATABASE_URL"];

  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL is required. " +
        "Set it to 'libsql://...turso.io' for production, " +
        "'file:./local.db' for local dev, or ':memory:' for tests."
    );
  }

  const authToken = process.env["TURSO_AUTH_TOKEN"];

  return createClient({
    url,
    authToken,
  });
}

/**
 * Singleton client for server-side use.
 * Import this in server loaders and actions.
 */
let _client: Client | null = null;

export function getDbClient(): Client {
  if (!_client) {
    _client = createDbClient();
  }
  return _client;
}
