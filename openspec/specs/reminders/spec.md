# Reminders Specification

## Purpose

Governs pre-kickoff reminder notifications sent to users who have not yet submitted a prediction for an upcoming match.

## Requirements

### Requirement: Pre-Kickoff Reminder via Web Push

The system MUST send a Web Push notification to authenticated users who have not submitted a prediction for a match, before that match's lock time (kickoff − 5min). Web Push is the only reminder channel in the MVP.

#### Scenario: Reminder sent to non-predictor

- GIVEN a user has subscribed to Web Push notifications
- AND they have not predicted for an upcoming match
- WHEN the per-match reminder fires before kickoff − 5min
- THEN a Web Push notification is sent to their subscription endpoint with a prompt to predict

#### Scenario: Reminder NOT sent to predictor

- GIVEN a user has already submitted a prediction for a match
- WHEN the per-match reminder fires
- THEN no notification is sent to that user for that match

#### Scenario: Reminder NOT sent to non-subscriber

- GIVEN a user has not granted Web Push permission or has not subscribed
- WHEN the per-match reminder fires
- THEN no notification attempt is made for that user (no error, silent skip)

### Requirement: Reminder Scheduling via Per-Match DO Alarm

Reminder scheduling MUST reuse the per-match Durable Object alarm infrastructure (same DO as the safety-net settlement alarm). The reminder alarm MUST fire before kickoff − 5min (e.g. approximately kickoff − 30min or a configurable offset).

#### Scenario: Reminder alarm scheduled when match is created or updated

- GIVEN a match is created or has its kickoff time updated
- WHEN the system processes the match record
- THEN a DO alarm is scheduled for the reminder window (e.g. kickoff − 30min)

#### Scenario: Reminder alarm fires and checks predictions

- GIVEN the reminder alarm fires for match X
- WHEN processing runs
- THEN the system queries which group members have NOT submitted a prediction for match X
- AND sends Web Push notifications only to those non-predictors who have an active subscription

### Requirement: Web Push Subscription Management

The system MUST provide a mechanism for users to grant or revoke Web Push notification permission. Subscriptions MUST be stored per-user in the DB (endpoint, keys). Revoked or expired subscriptions MUST be cleaned up.

#### Scenario: User subscribes to Web Push

- GIVEN an authenticated user
- WHEN they grant notification permission in the browser
- THEN the push subscription (endpoint + keys) is sent to the server and stored linked to the user

#### Scenario: User revokes subscription

- GIVEN a user has an active push subscription
- WHEN they revoke notification permission
- THEN the system deletes or marks the subscription inactive
- AND future reminders do not attempt delivery to that endpoint

#### Scenario: Expired or invalid subscription endpoint

- GIVEN a stored subscription endpoint that has expired (provider returns 410 Gone)
- WHEN a notification delivery attempt fails with 410
- THEN the subscription record is deleted
- AND no retry is attempted for that subscription
