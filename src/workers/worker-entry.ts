/**
 * Worker entry for @cloudflare/vitest-pool-workers tests.
 *
 * This file is used as the `main` option in cloudflarePool so that
 * the workers project can access the MatchDO class via its binding.
 *
 * It also serves as the default export for the Worker (required by the pool).
 */

export { MatchDO } from "./match-do";

// Default export required by Workers runtime
export default {
  async fetch(_request: Request, _env: unknown): Promise<Response> {
    return new Response("better-prode workers entry", { status: 200 });
  },
};
