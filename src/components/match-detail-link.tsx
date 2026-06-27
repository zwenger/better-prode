/**
 * MatchDetailLink — chevron affordance in a match card header that opens the
 * match detail page (/matches/$matchId).
 *
 * Lives in the card header (not wrapping the whole card) so it never conflicts
 * with the card's interactive children (steppers, save button, group-predictions
 * drawer).
 */

import { Link } from "@tanstack/react-router";

export function MatchDetailLink({ matchId }: { matchId: string }) {
  return (
    <Link
      to="/matches/$matchId"
      params={{ matchId }}
      aria-label="Ver detalle del partido"
      data-testid="match-detail-link"
      className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </Link>
  );
}
