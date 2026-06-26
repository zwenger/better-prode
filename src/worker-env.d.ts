/**
 * Cloudflare Worker environment bindings — augments Cloudflare.Env so that
 * `import { env } from "cloudflare:workers"` is typed correctly in server fns.
 *
 * Bindings defined in wrangler.jsonc must be reflected here.
 */

declare namespace Cloudflare {
  interface Env {
    MATCH_DO: DurableObjectNamespace;
    LEADERBOARD_CACHE: KVNamespace;
    /** Turso/libSQL database URL — passed as a secret var to the DO for DB settlement. */
    TURSO_DATABASE_URL: string;
    /** Turso/libSQL auth token — passed as a secret var to the DO for DB settlement. */
    TURSO_AUTH_TOKEN: string;
    /** Tournament DB id (e.g. "17-285023") — used by cron and on-demand refresh to scope listUnsettled. */
    TOURNAMENT_ID?: string;
  }
}
