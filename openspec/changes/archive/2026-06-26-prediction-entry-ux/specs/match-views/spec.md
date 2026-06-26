# Delta for Match Views

## MODIFIED Requirements

### Requirement: Prediction Entry UI

Prediction entry MUST use large +/− steppers for goal values (thumb-reachable on mobile, minimum 44 px touch target). The form MUST be disabled and show a locked state once the server lock time has passed (kickoff − 5min), as a UX affordance. The server-side lock is authoritative.

After a successful save, the card MUST display a transient "¡Guardado!" confirmation (at most ~1.5 s, respecting `prefers-reduced-motion`) and then return to an editable state. The submit control MUST be relabeled to reflect an existing prediction (e.g. "Editar predicción") and MUST remain interactive. There MUST be no permanent terminal state that hides the submit control for an unlocked match.

The card MUST be a shared controlled component: it receives `draftValue`, `onChange`, `savedValue`, and `hasSaved` props. It MUST NOT own its own load-and-submit logic for draft state; the page is responsible for draft management.

(Previously: the card entered a permanent "done" state after save, replacing the submit button permanently. The card was duplicated per route.)

#### Scenario: Prediction entry before lock

- GIVEN a match is not yet locked (server time < kickoff − 5min)
- WHEN the user views the match
- THEN +/− steppers for home and away goals are active and submission is available

#### Scenario: Prediction entry locked in UI after T−5min

- GIVEN the client detects the lock time has passed (server-provided kickoff time)
- WHEN the user views the match
- THEN the steppers are disabled and a "locked" indicator is shown
- AND the server will also reject any submission (as per predictions spec)

#### Scenario: Transient confirmation then return to editable

- GIVEN an unlocked match and a valid prediction submitted by the user
- WHEN the server responds with success
- THEN the card shows a brief "¡Guardado!" confirmation
- AND after the confirmation clears the card returns to an editable state
- AND the submit control is visible and labeled "Editar predicción"

#### Scenario: Reduced-motion — no animation for confirmation

- GIVEN the user's device has `prefers-reduced-motion: reduce` set
- WHEN a prediction is saved successfully
- THEN the confirmation is shown without animation (instant display/hide)

#### Scenario: Shared card used on both routes

- GIVEN the `/matches` and `/today` routes are both rendered
- WHEN a prediction card is displayed on either route
- THEN both routes use the same `PredictableMatchCard` component with identical behavior

---

## ADDED Requirements

### Requirement: Batch Save Affordance

When one or more predictions have been edited but not yet saved (dirty), the page MUST display a sticky affordance showing the count of dirty predictions and offering a single action to submit them all. The affordance MUST read "Guardar todas (N)" where N is the count of dirty predictions. It MUST be hidden when there are no dirty predictions. It MUST NOT overlap or trap content in a way that prevents interaction with match cards (safe inset respected). After batch submission, the affordance MUST reflect the per-match outcome inline.

The dirty count displayed in the affordance MUST be memoized so that individual stepper increments do not trigger unnecessary re-renders of the bar.

#### Scenario: Sticky bar appears when predictions are dirty

- GIVEN a user edits the goal values on one or more match cards
- WHEN at least one prediction differs from its last saved value
- THEN a sticky "Guardar todas (N)" bar is visible with the correct dirty count

#### Scenario: Sticky bar is hidden when nothing is dirty

- GIVEN no prediction has been edited since the last save (or page load)
- WHEN the user views the match list
- THEN the sticky bar is not rendered or is not visible

#### Scenario: Batch submit — success feedback inline

- GIVEN the user presses "Guardar todas (N)" and all dirty predictions succeed
- WHEN the batch completes
- THEN each affected card transitions through its transient confirmation and returns to editable
- AND the sticky bar disappears (no more dirty predictions)

#### Scenario: Batch submit — partial lock feedback

- GIVEN the user presses "Guardar todas (N)" and at least one match locked at submit time
- WHEN the batch completes
- THEN the sticky bar reflects the outcome (e.g. "X de N guardadas")
- AND the locked match's card shows an inline locked indicator
- AND successfully saved cards return to editable

#### Scenario: Sticky bar does not overlap match cards

- GIVEN the sticky bar is visible
- WHEN the user scrolls or interacts with match cards
- THEN all match card content and controls remain reachable (safe-area inset applied, no content trapped)

#### Scenario: Dirty count is stable during stepper ticks

- GIVEN the user is repeatedly tapping +/− on a stepper
- WHEN the dirty count has not changed (still same number of dirty predictions)
- THEN the sticky bar does not re-render on each tick

---

## Test Layer Annotations

| Requirement / Scenario | Layer | Reason |
|---|---|---|
| Prediction Entry UI — transient confirmation | E2E | Requires real DOM interaction / timing |
| Prediction Entry UI — shared card on both routes | Unit (component) | Render both routes, assert same element |
| Batch Save Affordance — appears/disappears | Unit (component) | Pure render logic based on dirty count |
| Batch Save Affordance — partial lock feedback | Unit (`aggregateBatchResults`) | Pure aggregation logic |
| Sticky bar does not overlap cards | E2E / manual | Requires visual / scroll verification |
| Dirty count stable during stepper ticks | Unit (memoization) | Assert memo dependency array correctness |
