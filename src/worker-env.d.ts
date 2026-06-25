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
  }
}
