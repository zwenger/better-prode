# Proposal: Reusable Group Invite Link

## Intent

The group invite link is broken in two ways:

- **Bug 2 (severe):** `joinViaToken` (`src/domain/groups.ts:185`) consumes the token by setting its status to `"accepted"` on the first join. The `status !== "pending"` guard then rejects every later join with `invalid_token`. Only ONE person can ever join via a link — wrong semantics for a group invite.
- **Bug 1:** the invite route (`src/routes/groups/$groupId/invite.tsx`) has no loader. The URL lives only in React `useState`, so it is lost on refresh/navigate. `getActiveByGroup` already exists in the repo but is never called on mount.

Success = a single link lets many members join and is viewable any time after creation.

## Scope

### In Scope
- Multi-use reusable token: remove the `updateStatus("accepted")` consume-on-join from `joinViaToken`; token stays `"pending"`.
- Invite route loader: call `getActiveByGroup(groupId)` on mount and show the persistent link with no "generar primero" gate.
- Idempotent generate: `generateInviteToken` returns the existing pending token instead of creating a duplicate row.
- Deterministic retrieval: add `ORDER BY created_at DESC` to `getActiveByGroup`.
- Graceful already-member: following the link when already a member shows "Ya sos miembro" with a path into the group (no hard error).

### Out of Scope
- No schema migration (no new column, no `used_by`, no per-user join tracking on the invitation row).
- No rework of revoke/rotate — already works (`revokeInvite` + `revokeFirst` flag).
- Removing the now-dead `"accepted"` status value — leave it; harmless.
- Optional/secondary: a "Compartir invitación" shortcut on members/standings — note only.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `groups`: invitation semantics change from single-use ("marks Invitation as accepted") to a reusable, persistent group link; the link is retrievable at any time via the invite route loader. Corrects the existing groups spec (line 42 + Invite-Link-Only Join requirement) which implied single-use.

## Approach

Adopt exploration **Option A (reusable invitation row, no migration)** over Option B (new `group.invite_token` column):

- Option A reuses the existing `invitation` table and the already-implemented `getActiveByGroup`. Smallest surface, zero migration, zero Turso prod schema risk. The invitation row IS the durable group code; joining only creates a membership.
- Option B requires `ALTER TABLE group`, a new adapter method, a domain refactor, and leaves the `invitation` table as dead weight — more code and migration risk for no functional gain here.

Existing "accepted"/single-use rows in prod simply stay non-joinable (those tokens were already consumed) — acceptable, no data migration.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/domain/groups.ts` | Modified | Remove consume-on-join in `joinViaToken`; idempotent `generateInviteToken` |
| `src/adapters/db/invitation-repository.ts` | Modified | `ORDER BY created_at DESC` in `getActiveByGroup` |
| `src/routes/groups/$groupId/invite.tsx` | Modified | Add loader calling `getActiveByGroup`; show link on mount |
| `src/routes/invite/$token.tsx` | Verified | Already handles already-member gracefully; confirm no regression |
| `src/domain/groups.test.ts` | New tests | Multi-user join, idempotent generate, retrieval |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Multiple pending rows per group accumulate | Med | Idempotent `generateInviteToken` + `ORDER BY created_at DESC` |
| Already-member UX (redirect vs message) | Low | Keep graceful "Ya sos miembro" message; redirect is a spec/design decision |
| Dead `"accepted"` status value | Low | Leave in enum; document as unused |
| Invite loader needs auth (route had none) | Low | Reuse existing loader auth pattern from other routes |

## Rollback Plan

Pure domain/route changes, no migration. Revert the commit to restore the `updateStatus("accepted")` line and remove the loader. No data backfill needed since no schema changed.

## Dependencies

- None. `getActiveByGroup` already exists in port + adapter.

## Success Criteria

- [x] Two different users join the same group via one link; the token remains `"pending"`.
- [x] The invite link is visible immediately on the invite page after refresh/navigate.
- [x] Calling generate twice for a group yields one pending row.
- [x] An already-member following the link sees a graceful message and a path into the group.
- [x] `getActiveByGroup` returns deterministically (newest pending first).
