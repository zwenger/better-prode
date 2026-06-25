/**
 * Cloudflare Worker environment bindings — augments Cloudflare.Env so that
 * `import { env } from "cloudflare:workers"` is typed correctly in server fns.
 *
 * Bindings defined in wrangler.jsonc must be reflected here.
 * Uses `import()` inside the interface to avoid turning this into a module file
 * (which would break global namespace augmentation).
 */

declare namespace Cloudflare {
  interface Env {
    MATCH_DO: DurableObjectNamespace<import("#/workers/match-do").MatchDO>;
    LEADERBOARD_CACHE: KVNamespace;
  }
}
