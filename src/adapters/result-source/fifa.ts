/**
 * FifaAdapter — anti-corruption layer between the FIFA API and the domain.
 *
 * Implements both TournamentSource and ResultSource ports.
 * ALL FIFA JSON parsing is confined here — the domain never sees
 * provider-specific shapes.
 *
 * Design decisions applied here:
 *   #1 — FifaAdapter implements TournamentSource + ResultSource (SRP)
 *   #2 — FIFA IdMatch/IdTeam stored with fifa-m- / fifa-t- prefixes for
 *         deterministic domain ids (idempotent import by PK)
 *   #4 — MatchStatus map: 0→finished, 1→scheduled, 3→in_progress;
 *         unknown → scheduled (safe default, never auto-finishes)
 *   #8 — FIFA→ISO lookup via explicit fifa-iso.ts table; null on gap
 *
 * Resilience:
 *   - AbortController timeout (8 s) on every request
 *   - Defensive per-field parsing: bad/missing field → skip record + warn,
 *     never throw the whole import on one bad record
 *   - API failure in getResult → returns null (structured error, not throw)
 */

import type { ResultSource, MatchResult } from "#/domain/ports/result-source";
import type {
  TournamentSource,
  TournamentStructure,
  TournamentTeam,
  TournamentMatch,
  MatchStatus,
} from "#/domain/ports/tournament-source";
import { getIsoCode } from "./fifa-iso";

// ---------------------------------------------------------------------------
// FIFA API response types (internal — NEVER exported to domain)
// ---------------------------------------------------------------------------

interface FifaLocalizedString {
  Locale: string;
  Description: string;
}

interface FifaTeamSide {
  IdTeam?: string;
  IdCountry?: string;
  TeamName?: FifaLocalizedString[];
  Abbreviation?: string;
  Score?: number | null;
}

interface FifaMatch {
  IdMatch?: string;
  IdCompetition?: string;
  IdSeason?: string;
  IdStage?: string;
  IdGroup?: string;
  Date?: string;
  MatchStatus?: number;
  MatchTime?: string;
  GroupName?: FifaLocalizedString[];
  StageName?: FifaLocalizedString[];
  SeasonName?: FifaLocalizedString[];
  Home?: FifaTeamSide;
  Away?: FifaTeamSide;
}

interface FifaApiResponse {
  Results: FifaMatch[];
}

// ---------------------------------------------------------------------------
// FIFA MatchStatus mapping table
// ---------------------------------------------------------------------------

export interface MapStatusResult {
  status: MatchStatus;
  warned: boolean;
}

/**
 * Map a FIFA MatchStatus integer to a domain MatchStatus.
 *
 * Empirically confirmed against live WC2026 data (June 2026):
 *   0 → "finished"   (has final score; e.g. Mexico 2-0 South Africa, time 98')
 *   1 → "scheduled"  (future, no score, time 0')
 *   3 → "in_progress" (live; e.g. Curaçao 0-2 Côte d'Ivoire, time 78')
 *
 * SAFE-DEFAULT RULE: any unknown code → "scheduled" + warned: true.
 * Unknown codes NEVER yield "finished" — a false finish triggers settlement
 * and prediction lock, which is unrecoverable without manual correction.
 */
export function mapStatus(code: number): MapStatusResult {
  switch (code) {
    case 0:
      return { status: "finished", warned: false };
    case 1:
      return { status: "scheduled", warned: false };
    case 3:
      return { status: "in_progress", warned: false };
    default:
      // Safe default: never auto-finish an unknown code
      return { status: "scheduled", warned: true };
  }
}

// ---------------------------------------------------------------------------
// Defensive per-field parsing helpers
// ---------------------------------------------------------------------------

const FIFA_API_BASE = "https://api.fifa.com/api/v3";
const REQUEST_TIMEOUT_MS = 8_000;

function parseTeamId(raw: string | undefined): string | null {
  if (!raw || typeof raw !== "string" || raw.trim() === "") return null;
  return `fifa-t-${raw.trim()}`;
}

function parseMatchId(raw: string | undefined): string | null {
  if (!raw || typeof raw !== "string" || raw.trim() === "") return null;
  return `fifa-m-${raw.trim()}`;
}

function parseKickoffUtc(raw: string | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

function parseScore(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "number" || isNaN(raw)) return null;
  return raw;
}

function parseGroup(names: FifaLocalizedString[] | undefined): string {
  return names?.[0]?.Description ?? "";
}

function parseTeamName(names: FifaLocalizedString[] | undefined): string {
  return names?.[0]?.Description ?? "";
}

// ---------------------------------------------------------------------------
// FifaAdapter
// ---------------------------------------------------------------------------

export interface FifaAdapterOptions {
  /** Injectable fetch — allows test doubles; defaults to global fetch. */
  fetch?: typeof fetch;
}

export class FifaAdapter implements TournamentSource, ResultSource {
  private readonly _fetch: typeof fetch;

  constructor(options: FifaAdapterOptions = {}) {
    this._fetch = options.fetch ?? globalThis.fetch;
  }

  // -------------------------------------------------------------------------
  // TournamentSource
  // -------------------------------------------------------------------------

  async fetchStructure(
    competitionId: string,
    seasonId: string
  ): Promise<TournamentStructure> {
    const url = `${FIFA_API_BASE}/calendar/matches?idCompetition=${competitionId}&idSeason=${seasonId}&from=&to=&count=500&language=en`;

    const raw = await this._fetchWithTimeout(url);

    const teamsMap = new Map<string, TournamentTeam>();
    const matches: TournamentMatch[] = [];
    const warnings: string[] = [];

    for (const m of raw.Results) {
      try {
        const matchId = parseMatchId(m.IdMatch);
        if (!matchId) {
          warnings.push(`Skipping match — invalid IdMatch: ${String(m.IdMatch)}`);
          continue;
        }

        const homeTeamId = parseTeamId(m.Home?.IdTeam);
        const awayTeamId = parseTeamId(m.Away?.IdTeam);
        if (!homeTeamId || !awayTeamId) {
          warnings.push(`Skipping match ${matchId} — missing team id`);
          continue;
        }

        const kickoffUtc = parseKickoffUtc(m.Date);
        if (!kickoffUtc) {
          warnings.push(`Skipping match ${matchId} — invalid Date: ${String(m.Date)}`);
          continue;
        }

        const statusCode = m.MatchStatus ?? -1;
        const { status, warned } = mapStatus(statusCode);
        if (warned) {
          warnings.push(
            `Match ${matchId}: unknown MatchStatus=${String(statusCode)}; defaulted to 'scheduled'`
          );
        }

        // Register teams (idempotent — same id seen in multiple matches)
        if (!teamsMap.has(homeTeamId)) {
          teamsMap.set(homeTeamId, {
            id: homeTeamId,
            name: parseTeamName(m.Home?.TeamName),
            code: getIsoCode(m.Home?.IdTeam ?? ""),
          });
        }
        if (!teamsMap.has(awayTeamId)) {
          teamsMap.set(awayTeamId, {
            id: awayTeamId,
            name: parseTeamName(m.Away?.TeamName),
            code: getIsoCode(m.Away?.IdTeam ?? ""),
          });
        }

        matches.push({
          id: matchId,
          homeTeamId,
          awayTeamId,
          kickoffUtc,
          status,
          homeScore: parseScore(m.Home?.Score),
          awayScore: parseScore(m.Away?.Score),
          group: parseGroup(m.GroupName),
          stage: m.IdStage ?? "",
        });
      } catch (err) {
        // Per-record defensive: log and skip, never abort the whole import
        warnings.push(
          `Skipping match due to unexpected parse error: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    if (warnings.length > 0) {
      console.warn(`[FifaAdapter] fetchStructure warnings:`, warnings);
    }

    // Derive tournament name from SeasonName on first match
    const seasonName =
      raw.Results[0]?.SeasonName?.[0]?.Description ?? "FIFA World Cup";

    return {
      tournamentId: `${competitionId}-${seasonId}`,
      name: seasonName,
      teams: [...teamsMap.values()],
      matches,
    };
  }

  // -------------------------------------------------------------------------
  // ResultSource
  // -------------------------------------------------------------------------

  async getResult(matchId: string): Promise<MatchResult | null> {
    // Extract the raw FIFA match id (strips the "fifa-m-" prefix)
    const rawId = matchId.replace(/^fifa-m-/, "");

    const url = `${FIFA_API_BASE}/calendar/matches?idCompetition=17&idSeason=285023&from=&to=&count=500&language=en`;

    let raw: FifaApiResponse;
    try {
      raw = await this._fetchWithTimeout(url);
    } catch {
      // API unreachable — structured error, not throw
      return null;
    }

    const m = raw.Results.find((r) => r.IdMatch === rawId);
    if (!m) {
      // [DIAG] temporary — remove after settlement debugging
      console.log(`[diag getResult] matchId=${matchId} rawId=${rawId} found=false totalResults=${raw.Results.length}`);
      return null;
    }

    const { status } = mapStatus(m.MatchStatus ?? -1);
    const homeScore = parseScore(m.Home?.Score);
    const awayScore = parseScore(m.Away?.Score);

    // [DIAG] temporary — remove after settlement debugging
    console.log(`[diag getResult] matchId=${matchId} fifaStatus=${String(m.MatchStatus)} mapped=${status} score=${String(homeScore)}-${String(awayScore)}`);

    return {
      matchId,
      homeScore: homeScore ?? 0,
      awayScore: awayScore ?? 0,
      status,
      source: "auto",
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async _fetchWithTimeout(url: string): Promise<FifaApiResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    );

    try {
      // Call through a local reference, NOT `this._fetch(url)`. The latter
      // invokes fetch as a method with `this` bound to the adapter instance,
      // which the Cloudflare Workers runtime rejects with "Illegal invocation"
      // (Node/undici ignores `this`, so it only fails on the edge). A standalone
      // call leaves `this` undefined, which global fetch accepts everywhere.
      const fetchFn = this._fetch;
      const response = await fetchFn(url, {
        signal: controller.signal,
        // api.fifa.com rejects requests without a browser-like User-Agent (the
        // Cloudflare Workers default UA returns non-OK). Send a realistic UA +
        // Accept so the public API responds identically from the edge runtime.
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(
          `FIFA API error: ${String(response.status)} ${response.statusText}`
        );
      }

      const body: unknown = await response.json();
      return body as FifaApiResponse;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
