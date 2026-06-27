/**
 * TeamFlag — renders a country flag from bundled SVGs (flag-icons).
 *
 * Uses flag-icons CSS class convention: `.fi.fi-{lowercase-code}`.
 * No external fetch, no CDN URL, no runtime network request.
 * SSR/edge-safe: flag-icons CSS is bundled by Vite at build time.
 *
 * Spec:
 *  - Valid ISO 3166-1 alpha-2 code → renders flag element
 *  - null / undefined / empty / unknown code → renders placeholder
 *
 * Design decision #7 (design.md):
 *  Bundled flag-icons SVGs keyed by ISO team.code.
 *  Unknown/null code → placeholder (no crash, no external request).
 */

import "flag-icons/css/flag-icons.css";
import validCodesData from "flag-icons/country.json";

// ---------------------------------------------------------------------------
// Build a lookup set from the country.json manifest
// (flag-icons ships 271 entries; we check membership at import time)
// ---------------------------------------------------------------------------

const VALID_CODES = new Set<string>(
  (validCodesData as Array<{ code: string }>).map((c) => c.code.toLowerCase())
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TeamFlagProps {
  /** ISO 3166-1 alpha-2 code (e.g. "AR", "MX"). Case-insensitive. null/undefined → placeholder. */
  code: string | null | undefined;
}

/**
 * Renders a country flag for the given ISO code using bundled flag-icons CSS.
 * Unknown or missing codes render a neutral placeholder — no crash, no fetch.
 */
export function TeamFlag({ code }: TeamFlagProps) {
  const normalized = code?.toLowerCase().trim() ?? "";

  const isValid = normalized.length > 0 && VALID_CODES.has(normalized);

  if (!isValid) {
    return (
      <span
        data-testid="flag-placeholder"
        aria-label="Unknown flag"
        className="fi-placeholder inline-block h-4 w-6 rounded bg-surface-subtle"
      />
    );
  }

  return (
    <span
      className={`fi fi-${normalized} inline-block`}
      aria-label={`Flag: ${code ?? ""}`}
      role="img"
    />
  );
}
