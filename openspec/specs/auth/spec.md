# Auth Specification

## Purpose

Governs user authentication and session management for better-prode. Only Google OAuth is supported in the MVP.

## Requirements

### Requirement: Google-Only Authentication

The system MUST authenticate users exclusively via Google OAuth using Better Auth. No email/password, no other providers in MVP.

#### Scenario: Successful Google sign-in (new user)

- GIVEN a visitor is not authenticated
- WHEN they initiate Google sign-in and Google returns a valid OAuth callback
- THEN a user record is created in the local DB with the Google-provided id, email, and display name
- AND a session is established and the user is redirected to the app

#### Scenario: Successful Google sign-in (returning user)

- GIVEN an existing user's record is in the DB
- WHEN they complete Google OAuth
- THEN the existing record is used (no duplicate created)
- AND a session is established

#### Scenario: OAuth callback failure

- GIVEN the Google OAuth flow returns an error
- WHEN the callback is processed
- THEN no session is created
- AND the user is shown an authentication error page

#### Scenario: Unauthenticated access to protected route

- GIVEN a visitor without a valid session
- WHEN they request any authenticated route
- THEN the server returns a redirect to the sign-in page

### Requirement: User Record Ownership

The system MUST store all user records in the application's own Turso database. No user data MAY be stored exclusively in a third-party auth service.

#### Scenario: User profile fields

- GIVEN a user authenticates via Google
- WHEN the user record is created or updated
- THEN the record MUST contain: unique internal id, Google subject id, email, display name, and created-at (UTC)

### Requirement: Session Security

The system MUST use server-managed sessions. Session validity MUST be checked server-side on every authenticated request.

#### Scenario: Session expiry

- GIVEN a user has an expired or revoked session cookie
- WHEN they make an authenticated request
- THEN the server rejects the request and redirects to sign-in
