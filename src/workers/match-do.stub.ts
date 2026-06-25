/**
 * MatchDO — per-match Durable Object stub.
 *
 * PR 0: Skeleton only — declares the class so wrangler bindings resolve.
 * Full single-flight + alarm implementation lands in PR 1 (task 1.10).
 */
export class MatchDO {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(_request: Request): Promise<Response> {
    return new Response("MatchDO stub — not yet implemented", { status: 501 });
  }
}
