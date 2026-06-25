/**
 * FIFA team id → ISO 3166-1 alpha-2 country code mapping table.
 *
 * Design decision #8: FIFA codes are NOT the same as ISO-3166-1.
 * This explicit lookup table is auditable and admin-correctable.
 *
 * Keys: FIFA IdTeam (string, as returned by the API).
 * Values: ISO 3166-1 alpha-2 code, or null when not yet confirmed.
 *
 * Source: WC2026 competitor list cross-referenced with ISO-3166-1 alpha-2.
 * Captured: 2026-06-25 against api.fifa.com/api/v3/calendar/matches
 *           (idCompetition=17, idSeason=285023)
 *
 * Note: "unknown ids → null (no throw)" — callers must handle null gracefully.
 */

export const FIFA_ISO_MAP: Record<string, string | null> = {
  // Africa (CAF)
  "43843": "DZ", // Algeria
  "43850": "CV", // Cabo Verde
  "43854": "CI", // Côte d'Ivoire
  "43855": "EG", // Egypt
  "43860": "GH", // Ghana
  "43872": "MA", // Morocco
  "43879": "SN", // Senegal
  "43883": "ZA", // South Africa
  "43888": "TN", // Tunisia
  "20014": "CD", // Congo DR

  // Asia (AFC)
  "43817": "IR", // IR Iran
  "43818": "IQ", // Iraq
  "43819": "JP", // Japan
  "43820": "JO", // Jordan
  "43822": "KR", // Korea Republic
  "43834": "QA", // Qatar
  "43835": "SA", // Saudi Arabia
  "44005": "UZ", // Uzbekistan

  // CONCACAF
  "43899": "CA", // Canada
  "43908": "HT", // Haiti
  "43911": "MX", // Mexico
  "43914": "PA", // Panama
  "43921": "US", // USA
  "1895293": "CW", // Curaçao

  // CONMEBOL
  "43922": "AR", // Argentina
  "43924": "BR", // Brazil
  "43926": "CO", // Colombia
  "43927": "EC", // Ecuador
  "43928": "PY", // Paraguay
  "43930": "UY", // Uruguay

  // Europe (UEFA)
  "43934": "AT", // Austria
  "43935": "BE", // Belgium
  "44037": "BA", // Bosnia and Herzegovina
  "43938": "HR", // Croatia
  "43995": "CZ", // Czechia
  "43942": "GB-ENG", // England — TODO: confirm; ISO 3166-2 for constituent country
  "43946": "FR", // France
  "43948": "DE", // Germany
  "43960": "NL", // Netherlands
  "43961": "NO", // Norway
  "43963": "PT", // Portugal
  "43967": "GB-SCT", // Scotland — TODO: confirm; ISO 3166-2 for constituent country
  "43969": "ES", // Spain
  "43970": "SE", // Sweden
  "43971": "CH", // Switzerland
  "43972": "TR", // Türkiye

  // OFC
  "43976": "AU", // Australia
  "43978": "NZ", // New Zealand
};

/**
 * Look up the ISO 3166-1 alpha-2 code for a FIFA team id.
 *
 * @returns the ISO code string, or null if not yet mapped.
 *          NEVER throws — callers handle null gracefully.
 */
export function getIsoCode(fifaTeamId: string): string | null {
  return FIFA_ISO_MAP[fifaTeamId] ?? null;
}
