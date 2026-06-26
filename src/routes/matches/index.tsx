/**
 * Match list route — /matches
 *
 * Shows real team names + flags, splits matches into:
 *   - "Para predecir": scheduled & not-locked matches (with score steppers)
 *   - "En vivo": in-progress matches (live score, locked)
 *   - "Resultados": finished matches (final score, no steppers)
 *
 * Server enforces the lock; client disables steppers at T-5min as an affordance.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "#/infra/db/client";
import { match as matchTable, team as teamTable } from "#/infra/db/schema";
import { getRequest } from "@tanstack/start-server-core";
import { auth } from "#/infra/auth/auth";
import { SystemClock } from "#/domain/ports/clock";
import { submitPrediction } from "#/routes/api/predictions/-submit";
import { TeamFlag } from "#/components/team-flag";
import { ScoreStepper } from "#/components/score-stepper";
import { DrizzlePredictionRepository } from "#/adapters/db/prediction-repository";
import { shapeMatchRows, formatKickoffUtc } from "#/routes/matches/-match-list-loader";
import type { MatchListItem } from "#/routes/matches/-match-list-loader";

interface LoaderData {
  matches: MatchListItem[];
  userId: string | null;
}

const getMatches = createServerFn({ method: "GET" }).handler(
  async (): Promise<LoaderData> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });
    const db = getDb();
    const clock = new SystemClock();

    const home = alias(teamTable, "home");
    const away = alias(teamTable, "away");

    const rows = await db
      .select({
        id: matchTable.id,
        homeName: home.name,
        homeCode: home.code,
        awayName: away.name,
        awayCode: away.code,
        kickoffUtc: matchTable.kickoffUtc,
        status: matchTable.status,
        homeScore: matchTable.homeScore,
        awayScore: matchTable.awayScore,
        groupLabel: matchTable.groupLabel,
        homeTeamId: matchTable.homeTeamId,
        awayTeamId: matchTable.awayTeamId,
      })
      .from(matchTable)
      .leftJoin(home, eq(matchTable.homeTeamId, home.id))
      .leftJoin(away, eq(matchTable.awayTeamId, away.id))
      .orderBy(asc(matchTable.kickoffUtc))
      .limit(120);

    // Task 4.6: fetch the current user's predictions so PredictableCard can
    // initialize its steppers to the saved values (fixes the 0-0 reload bug).
    const userId = session?.user.id ?? null;
    let userPredictionMap = new Map<string, { homeGoals: number; awayGoals: number }>();

    if (userId) {
      const matchIds = rows.map((r) => r.id);
      const predRepo = new DrizzlePredictionRepository(db);
      const rawMap = await predRepo.findByUserForMatches(userId, matchIds);
      userPredictionMap = new Map(
        [...rawMap.entries()].map(([matchId, pred]) => [
          matchId,
          { homeGoals: pred.homeGoals, awayGoals: pred.awayGoals },
        ])
      );
    }

    // shapeMatchRows: pure mapping — tested in -match-list-loader.test.ts
    const matches = shapeMatchRows(rows, userPredictionMap, clock.now());

    return { matches, userId };
  }
);

export const Route = createFileRoute("/matches/")({
  loader: async () => getMatches(),
  component: MatchListPage,
});

function TeamLabel({
  name,
  code,
  align,
}: {
  name: string;
  code: string | null;
  align: "left" | "right";
}) {
  return (
    <div
      className={`flex items-center gap-2 flex-1 min-w-0 ${align === "right" ? "justify-end text-right" : "justify-start"}`}
    >
      {align === "right" && <span className="font-medium truncate">{name}</span>}
      <TeamFlag code={code} />
      {align === "left" && <span className="font-medium truncate">{name}</span>}
    </div>
  );
}


function MatchHeader({ match }: { match: MatchListItem }) {
  return (
    <div className="flex justify-between items-center mb-3 text-sm text-muted-foreground">
      <span>
        {match.groupLabel ? `${match.groupLabel} · ` : ""}
        {formatKickoffUtc(match.kickoffUtc)}
      </span>
      {match.status === "in_progress" && (
        <span className="text-xs font-semibold text-red-500">● EN VIVO</span>
      )}
    </div>
  );
}

/** Predictable (scheduled, not locked) match — steppers + submit.
 *
 * Task 4.6 fix: steppers are initialized from match.userPrediction (hydrated by
 * the loader) so a previously saved prediction is shown on reload instead of
 * defaulting to 0-0.  The button copy reflects "edit" vs "add" affordance per spec.
 */
function PredictableCard({
  match,
  userId,
}: {
  match: MatchListItem;
  userId: string | null;
}) {
  // Initialize from the server-hydrated prediction; default to 0 when none exists.
  const [homeGoals, setHomeGoals] = useState(match.userPrediction?.homeGoals ?? 0);
  const [awayGoals, setAwayGoals] = useState(match.userPrediction?.awayGoals ?? 0);
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "locked" | "error">("idle");
  const navigate = useNavigate();

  const hasPrediction = match.userPrediction !== null;

  const handleSubmit = async () => {
    if (!userId) {
      navigate({ to: "/" });
      return;
    }
    setStatus("submitting");
    try {
      const result = await submitPrediction({
        data: { matchId: match.id, homeGoals, awayGoals },
      });
      setStatus(result.locked ? "locked" : "done");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="p-4 border rounded mb-3" data-testid="match-card" data-match-id={match.id}>
      <MatchHeader match={match} />
      <div className="flex items-center justify-between gap-2 mb-4">
        <TeamLabel name={match.homeName} code={match.homeCode} align="left" />
        <span className="text-xs text-muted-foreground shrink-0">vs</span>
        <TeamLabel name={match.awayName} code={match.awayCode} align="right" />
      </div>
      <div className="flex items-center justify-center gap-3">
        <ScoreStepper value={homeGoals} onChange={setHomeGoals} disabled={status === "submitting"} label="home goals" />
        <span className="text-lg font-bold">:</span>
        <ScoreStepper value={awayGoals} onChange={setAwayGoals} disabled={status === "submitting"} label="away goals" />
      </div>
      {status !== "done" && (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={status === "submitting"}
          className="mt-3 w-full py-2 bg-primary text-primary-foreground rounded font-medium disabled:opacity-50"
          data-testid="submit-prediction"
        >
          {status === "submitting"
            ? "Guardando…"
            : hasPrediction
              ? "Editar predicción"
              : "Guardar predicción"}
        </button>
      )}
      {status === "done" && (
        <p className="mt-2 text-sm text-green-600" data-testid="prediction-saved">
          ¡Predicción guardada!
        </p>
      )}
      {status === "locked" && (
        <p className="mt-2 text-sm text-orange-500" data-testid="prediction-locked">
          El partido ya está cerrado.
        </p>
      )}
      {status === "error" && (
        <p className="mt-2 text-sm text-red-500">Error al guardar. Probá de nuevo.</p>
      )}
    </div>
  );
}

/** Finished or in-progress match — show the score, no steppers. */
function ResultCard({ match }: { match: MatchListItem }) {
  return (
    <div className="p-4 border rounded mb-3" data-testid="match-card" data-match-id={match.id}>
      <MatchHeader match={match} />
      <div className="flex items-center justify-between gap-3">
        <TeamLabel name={match.homeName} code={match.homeCode} align="right" />
        <div className="shrink-0 font-bold text-2xl tabular-nums">
          {match.homeScore ?? "–"} : {match.awayScore ?? "–"}
        </div>
        <TeamLabel name={match.awayName} code={match.awayCode} align="left" />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function MatchListPage() {
  const { matches, userId } = Route.useLoaderData();

  const predictable = matches.filter((m) => m.status === "scheduled" && !m.locked);
  const live = matches.filter((m) => m.status === "in_progress");
  // Finished + scheduled-but-locked, most recent first.
  const finished = matches
    .filter((m) => m.status === "finished")
    .sort((a, b) => b.kickoffUtc.localeCompare(a.kickoffUtc));

  return (
    <div className="p-4 max-w-lg mx-auto" data-testid="match-list">
      <h1 className="text-2xl font-bold mb-6">Partidos</h1>

      {matches.length === 0 && (
        <p className="text-muted-foreground" data-testid="no-matches">
          No hay partidos todavía.
        </p>
      )}

      {live.length > 0 && (
        <Section title="En vivo">
          {live.map((m) => (
            <ResultCard key={m.id} match={m} />
          ))}
        </Section>
      )}

      {predictable.length > 0 ? (
        <Section title="Para predecir">
          {predictable.map((m) => (
            <PredictableCard key={m.id} match={m} userId={userId} />
          ))}
        </Section>
      ) : (
        matches.length > 0 && (
          <p className="text-muted-foreground mb-8" data-testid="nothing-to-predict">
            No hay partidos abiertos para predecir ahora mismo.
          </p>
        )
      )}

      {finished.length > 0 && (
        <Section title="Resultados">
          {finished.map((m) => (
            <ResultCard key={m.id} match={m} />
          ))}
        </Section>
      )}
    </div>
  );
}
