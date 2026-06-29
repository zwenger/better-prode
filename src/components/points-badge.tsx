/**
 * PointsBadge — points pill for a settled prediction.
 *
 * Single shared component (previously duplicated identically in
 * matches/$matchId.tsx and matches/-match-detail-prediction-area.tsx).
 *
 * Colors encode the outcome tier:
 *   - Pleno (PLENO_POINTS): glory gold
 *   - Any other positive total: pitch-green tint
 *   - Zero: miss-red tint
 */

import { PLENO_POINTS } from "#/domain/scoring";

export function PointsBadge({ points }: { points: number }) {
  const pleno = points === PLENO_POINTS;
  const style: React.CSSProperties = pleno
    ? { backgroundColor: "var(--glory-gold)", color: "var(--glory-gold-ink)" }
    : points > 0
      ? { backgroundColor: "var(--pitch-green-tint)", color: "var(--pitch-green-ink)" }
      : { backgroundColor: "var(--miss-red-tint)", color: "var(--miss-red-ink)" };
  return (
    <span
      className="shrink-0 rounded-full px-2.5 py-1 text-sm font-bold tabular-nums"
      style={style}
    >
      {pleno ? `✦ +${PLENO_POINTS}` : `+${points}`}
    </span>
  );
}
