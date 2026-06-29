/**
 * decodePlaceholder — pure domain function.
 *
 * Maps a FIFA placeholder code to a human-readable Spanish label.
 * Used for knockout matches where one or both teams are not yet determined.
 *
 * Spec (decodePlaceholder):
 *   W{n}     → "Ganador partido {n}"
 *   RU{n}    → "Perdedor partido {n}"
 *   1{X}     → "1° Grupo {X}"
 *   2{X}     → "2° Grupo {X}"
 *   3{XXXX}  → "Mejor 3° (A/B/C/D/...)" — letters joined by "/"
 *   null / "" / unrecognized → "Por confirmar"
 *
 * Contract: pure — never throws (it only runs regex matches and string ops on
 * the input, neither of which can throw), and never returns a raw FIFA code.
 */

const FALLBACK = "Por confirmar";

// Patterns ordered by specificity (most specific first)
const WINNER_MATCH = /^W(\d+)$/;
const RUNNER_UP_MATCH = /^RU(\d+)$/;
const FIRST_PLACE_GROUP = /^1([A-Z])$/;
const SECOND_PLACE_GROUP = /^2([A-Z])$/;
const BEST_THIRD_GROUPS = /^3([A-Z]{2,})$/;

/**
 * Decode a FIFA placeholder code into a Spanish human-readable label.
 *
 * @param code - FIFA placeholder string (e.g. "W74", "RU101", "1A", "3ABCDF"),
 *               or null when no placeholder is set.
 * @returns A Spanish label (e.g. "Ganador partido 74") or "Por confirmar".
 */
export function decodePlaceholder(code: string | null): string {
  if (!code) return FALLBACK;

  let match: RegExpMatchArray | null;

  match = code.match(WINNER_MATCH);
  if (match) return `Ganador partido ${match[1]}`;

  match = code.match(RUNNER_UP_MATCH);
  if (match) return `Perdedor partido ${match[1]}`;

  match = code.match(FIRST_PLACE_GROUP);
  if (match) return `1° Grupo ${match[1]}`;

  match = code.match(SECOND_PLACE_GROUP);
  if (match) return `2° Grupo ${match[1]}`;

  match = code.match(BEST_THIRD_GROUPS);
  if (match) {
    const letters = match[1].split("").join("/");
    return `Mejor 3° (${letters})`;
  }

  return FALLBACK;
}
