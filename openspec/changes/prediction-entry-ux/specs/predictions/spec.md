# Delta for Predictions

## ADDED Requirements

### Requirement: Prediction Remains Editable After Save

After a user successfully saves or updates a prediction (before the lock time), the system MUST return to an editable state. A transient confirmation MAY be displayed briefly, but the submit control MUST reappear and the user MUST be able to edit and re-save without a page reload. The system MUST NOT enter a permanent terminal UI state (no "done" branch that hides the control).

The server's `submitPredictionCore` MUST return a structured result (`{ success, locked, error }`) for every outcome. It MUST NOT throw on a `422 match_locked` response; instead it MUST return `{ locked: true }`. Callers MUST inspect the result to determine UI state.

#### Scenario: Save before lock — transient confirmation then editable

- GIVEN an authenticated user has an unlocked match
- WHEN they submit a prediction and the server responds with success
- THEN a transient confirmation is displayed (at most ~1.5 s)
- AND the card returns to an editable state with the submit control labeled to reflect an existing prediction
- AND no page reload is required

#### Scenario: Re-edit and re-save after first save

- GIVEN a user has already saved a prediction and the card has returned to editable
- WHEN they change the goal values and submit again
- THEN the system sends a second save request
- AND the card shows a transient confirmation then returns to editable again

#### Scenario: Regression — submit control never disappears for an unlocked match

- GIVEN a match is not yet locked
- WHEN the user saves a prediction
- THEN the submit control is visible and interactive after the confirmation clears
- AND the user can click/tap it without reloading the page

#### Scenario: Server returns locked — card reflects locked state

- GIVEN the server returns `{ locked: true }` for a save attempt
- WHEN the card receives this result
- THEN the card transitions to a locked display (not to a permanent "done" state)
- AND no editable controls are shown (consistent with locked-match behavior)

---

### Requirement: Batch Save Multiple Predictions

The system MUST allow a user to batch-submit predictions for multiple matches in one action. Each match prediction in the batch MUST be validated, lock-checked, and upserted independently through the existing single-prediction choke point (`submitPredictionCore`). The batch MUST return a per-match result (`success | locked | error`). Partial failure MUST be tolerated — a locked match in the batch MUST NOT fail the remaining matches. Only predictions that differ from the last known saved value (dirty) SHOULD be included in the batch.

#### Scenario: Batch submit — all succeed

- GIVEN a user has set (or changed) predictions for 3 unlocked matches
- WHEN they trigger batch save
- THEN all 3 predictions are submitted independently in parallel
- AND all 3 are upserted successfully
- AND the result reports 3 successes

#### Scenario: Batch submit — one match locks at submit time

- GIVEN a user has dirty predictions for matches A, B, and C
- AND match B's lock time passes between the user editing and submitting
- WHEN they trigger batch save
- THEN matches A and C are upserted successfully
- AND match B returns `{ locked: true }`
- AND the aggregate result reports 2 saved, 1 locked

#### Scenario: Idempotent re-submit — same values already saved

- GIVEN a user batch-submits the same goal values that are already persisted
- WHEN the batch executes
- THEN the upsert is a no-op (values unchanged)
- AND the result reports success (no conflict, no error)

#### Scenario: Only dirty predictions are submitted

- GIVEN a user has 5 matches loaded, 2 with changed values and 3 unchanged
- WHEN they trigger batch save
- THEN only the 2 dirty predictions are included in the batch
- AND the 3 unchanged predictions are not submitted

---

## Test Layer Annotations

| Requirement / Scenario | Layer | Reason |
|---|---|---|
| Prediction Remains Editable — all scenarios | Unit (pure fn: `isDirty`) + E2E | Button-reappear must be validated end-to-end |
| `submitPredictionCore` returns `{locked}` instead of throwing | Unit | Pure function contract |
| Batch Save — all succeed | Integration (libSQL) | Tests actual upsert path |
| Batch Save — partial lock | Unit (`aggregateBatchResults`) + Integration | Aggregation is pure; lock is server state |
| Idempotent re-submit | Integration | DB state must be verified |
| Only dirty predictions submitted | Unit (`isDirty`) | Pure function, no side effects |
