/**
 * Leaderboard access control — pure domain helper.
 *
 * W5: Checks that the requesting user is authenticated AND is a member of
 * the requested group before the leaderboard data can be fetched.
 *
 * Returns an error string if access should be denied, or null if allowed.
 * Throwing the HTTP error is the caller's responsibility.
 */

export type MembershipChecker = (userId: string, groupId: string) => Promise<boolean>;

export async function checkLeaderboardAccess(
  userId: string | null | undefined,
  groupId: string,
  isMember: MembershipChecker
): Promise<string | null> {
  if (!userId) {
    return "Unauthorized";
  }

  const member = await isMember(userId, groupId);
  if (!member) {
    return "Forbidden: you are not a member of this group";
  }

  return null;
}
