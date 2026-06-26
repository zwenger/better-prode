# Tasks: Reusable Group Invite Link

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~80–120 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Domain + repo fixes + route loader + e2e update | PR 1 | Single coherent slice; all 4 files; tests included |

---

## Phase 1: Domain — Multi-use Token (TDD RED → GREEN)

- [x] 1.1 **RED** — `src/domain/groups.test.ts` ~line 232: update existing test `"creates a membership with role member and marks the invitation accepted"` → rename it and change the `expect(inv?.status).toBe("accepted")` assertion to `toBe("pending")`. Run vitest — test must FAIL.
- [x] 1.2 **RED** — `src/domain/groups.test.ts`: add new test `"second user joins the same group via the same token — both memberships exist, token stays pending"`. Joins user-1 and user-2 via the same token; asserts two memberships; asserts `inv.status === "pending"`. Run vitest — test must FAIL.
- [x] 1.3 **GREEN** — `src/domain/groups.ts` line 185: remove `await invitationRepo.updateStatus(invitation.id, "accepted")` from `joinViaToken`. Run vitest — 1.1 and 1.2 must PASS; all other tests must PASS.

## Phase 2: Domain — Idempotent generateInviteToken (TDD RED → GREEN)

- [x] 2.1 **RED** — `src/domain/groups.test.ts`: add test `"generateInviteToken returns existing pending token when one already exists — no new row created"`. Call generate twice; assert both returned invitation IDs are equal; assert mock `create` was called exactly once. Run vitest — test must FAIL.
- [x] 2.2 **GREEN** — `src/domain/groups.ts` in `generateInviteToken` (before `invitationRepo.create`): call `invitationRepo.getActiveByGroup(input.groupId)`; if a pending invitation is returned, return `{ invitation: existing, url: \`/invite/\${existing.token}\` }` immediately without calling `create`. Run vitest — 2.1 must PASS; all prior tests still PASS.

## Phase 3: Repository — Deterministic ORDER BY (TDD RED → GREEN)

- [x] 3.1 **RED** — `src/adapters/db/invitation-repository.test.ts`: add test `"getActiveByGroup returns the most recently created pending row when multiple exist"`. Insert two pending rows with different `created_at` values; assert the returned token matches the newer row's token. Run vitest — test must FAIL (current query has no ORDER BY).
- [x] 3.2 **GREEN** — `src/adapters/db/invitation-repository.ts` in `getActiveByGroup`: add `.orderBy(desc(invitationTable.createdAt))` (import `desc` from drizzle-orm). Run vitest — 3.1 must PASS; existing `getActiveByGroup` tests still PASS.

## Phase 4: Route Loader — Invite Page Shows Link on Mount

- [x] 4.1 **GREEN** (no prior RED needed — UI integration): `src/routes/groups/$groupId/invite.tsx` — add a `createServerFn` loader (`getActiveInviteLoader`) that calls `invitationRepo.getActiveByGroup(groupId)`, builds the full URL if found, and returns `{ inviteUrl: string | null }`. Auth check: same pattern as `generateInviteLinkAction` (session guard, 401 on missing session).
- [x] 4.2 Add `loader` to the route definition: `Route = createFileRoute(...)({ loader: () => getActiveInviteLoader({ data: { groupId } }), component: InvitePage })`. Seed initial `inviteUrl` state from `Route.useLoaderData()` so the link displays immediately on mount without clicking generate.
- [x] 4.3 Remove the `{!inviteUrl ? <generateButton> : <linkPanel>}` gate behavior that hides the link panel on first render. The link panel MUST render immediately when `loaderData.inviteUrl` is non-null; the generate button is shown only when `loaderData.inviteUrl` is null.

## Phase 5: E2E — Extend Invite/Join Flow

- [x] 5.1 `tests/e2e/groups.spec.ts` — update test `"group owner can generate an invite link"`: adapted to handle the loader pre-fetch (link may already be visible without clicking generate). Keep all existing testids (`invite-url`, `generate-invite-btn`, `copy-invite-btn`, `revoke-and-regenerate-btn`).
- [x] 5.2 `tests/e2e/groups.spec.ts` — added new test `"invite token stays pending — existing member sees the join page not 'invalid invite'"` that confirms an already-member user B navigating to the same invite link sees `invite-join-page` (token still pending), not `invalid-invite`. Preserve existing testids and `groups-empty-state`, leaderboard assertions.
- [x] 5.3 Verify end-to-end: all 335 unit tests pass; 12 workers tests pass; all 54 Playwright e2e tests pass (stable across 3 consecutive runs).
