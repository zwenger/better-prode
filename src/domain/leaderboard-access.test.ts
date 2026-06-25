/**
 * TDD: checkLeaderboardAccess — W5 RED → GREEN
 *
 * Spec (leaderboard, auth):
 *   - Unauthenticated (null userId) → rejected with "Unauthorized"
 *   - Authenticated but not a group member → rejected with "Forbidden"
 *   - Authenticated + member → allowed (returns null)
 */

import { describe, it, expect } from "vitest";
import { checkLeaderboardAccess } from "./leaderboard-access";

const GROUP_ID = "group-1";

describe("checkLeaderboardAccess", () => {
  it("rejects unauthenticated (null userId)", async () => {
    const isMember = async () => true; // would allow if reached
    const result = await checkLeaderboardAccess(null, GROUP_ID, isMember);
    expect(result).toBe("Unauthorized");
  });

  it("rejects unauthenticated (undefined userId)", async () => {
    const isMember = async () => true;
    const result = await checkLeaderboardAccess(undefined, GROUP_ID, isMember);
    expect(result).toBe("Unauthorized");
  });

  it("rejects authenticated non-member", async () => {
    const isMember = async () => false;
    const result = await checkLeaderboardAccess("user-123", GROUP_ID, isMember);
    expect(result).not.toBeNull();
    expect(result).toContain("Forbidden");
  });

  it("allows authenticated group member", async () => {
    const isMember = async () => true;
    const result = await checkLeaderboardAccess("user-123", GROUP_ID, isMember);
    expect(result).toBeNull();
  });
});
