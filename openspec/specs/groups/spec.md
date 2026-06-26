# Groups Specification

## Purpose

Governs the lifecycle of prediction groups: creation, invite-link-only joining, member management, and roles. Groups are a comparison lens for predictions; they do not own prediction data.

## Requirements

### Requirement: Group Creation

The system MUST allow any authenticated user to create a group. The creator automatically becomes the group owner.

#### Scenario: Successful group creation

- GIVEN an authenticated user
- WHEN they submit a group name (non-empty, <= 60 chars)
- THEN a group record is created with a unique id
- AND a GroupMembership record is created with role "owner" for the creator

#### Scenario: Group name validation

- GIVEN an authenticated user submits a create-group request
- WHEN the name is empty or exceeds 60 characters
- THEN the server rejects with HTTP 400

### Requirement: Invite-Link-Only Join

Groups MUST NOT be publicly discoverable. The only way to join a group is via an invite link containing a unique token. There is no search, directory, or open-join mechanism in the MVP.

#### Scenario: Invite link generation

- GIVEN the group owner or an admin views group settings
- WHEN they request a new invite link
- THEN the system generates a cryptographically random token and stores an Invitation record (token, group_id, created_by, created_at UTC, status "active")
- AND a shareable URL containing the token is returned

#### Scenario: Valid invite link accepted

- GIVEN a user has an active session and holds a valid invite token
- WHEN they navigate to the invite URL
- THEN the system presents the group name and a join prompt
- AND on confirmation, creates a GroupMembership with role "member" and marks the Invitation as "accepted"

#### Scenario: Invalid or expired invite token

- GIVEN a token that does not exist or has been revoked
- WHEN the user navigates to the invite URL
- THEN the system returns a 404 or "invalid invite" page
- AND no GroupMembership is created

#### Scenario: Already-member follows invite link

- GIVEN a user who is already a member of the group
- WHEN they follow the invite link
- THEN the system detects the existing membership and shows an "already a member" message
- AND no duplicate GroupMembership is created

#### Scenario: Zero-groups empty state

- GIVEN an authenticated user who belongs to no groups
- WHEN they view the groups screen
- THEN the UI MUST display a prompt to create a new group OR enter an invite code/link
- AND no groups list is shown

### Requirement: Member Management

Group owners and admins MUST be able to remove members. Members MAY leave a group themselves.

#### Scenario: Owner or admin removes a member

- GIVEN a user with role "owner" or "admin" in a group
- WHEN they remove a member (role "member")
- THEN the GroupMembership record is deleted
- AND the removed user no longer sees that group or its predictions

#### Scenario: Member self-removal

- GIVEN a user with role "member"
- WHEN they choose to leave the group
- THEN their GroupMembership record is deleted

#### Scenario: Owner cannot remove themselves

- GIVEN the group owner
- WHEN they attempt to remove themselves from the group
- THEN the server rejects with HTTP 422
- AND the group retains an owner

### Requirement: Owner and Admin Roles

Groups MUST support two authority levels: owner/admin (elevated) and member (base). Only the owner MAY promote members to admin or demote admins to member.

#### Scenario: Owner promotes member to admin

- GIVEN a user with role "owner"
- WHEN they promote a member to "admin"
- THEN the GroupMembership role is updated to "admin"

#### Scenario: Admin cannot promote to owner

- GIVEN a user with role "admin"
- WHEN they attempt to set another member's role to "owner"
- THEN the server rejects with HTTP 403

#### Scenario: Member cannot perform management actions

- GIVEN a user with role "member"
- WHEN they attempt to remove another member or generate an invite link
- THEN the server rejects with HTTP 403

### Requirement: User in Many Groups

A user MUST be able to belong to multiple groups simultaneously. Their single prediction per (user, match) is visible in all their groups.

#### Scenario: User joins a second group

- GIVEN a user already in group A with predictions
- WHEN they join group B via an invite link
- THEN their existing predictions are immediately visible in group B's leaderboard and match views

### Requirement: Invite Revocation

Group owners and admins MUST be able to revoke an active invite link.

#### Scenario: Invite link revoked

- GIVEN an active invite token
- WHEN an owner or admin revokes it
- THEN the Invitation status is set to "revoked"
- AND any subsequent use of the token returns an invalid-invite response
