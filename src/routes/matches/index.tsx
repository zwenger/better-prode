/**
 * Match list route — /matches
 *
 * Tracer bullet (PR 1): minimal match list with prediction entry.
 * Shows scheduled matches with ScoreStepper inputs.
 * Server enforces lock; client disables stepper at T-5min as UX affordance.
 *
 * Spec (match-views): mobile-first, large +/- steppers, server-authoritative lock.
 * Full UI polish (frozen predictions drawer, in-progress surfacing) lands in PR 4.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getDbClient } from "#/infra/db/client";
import { getRequest } from "@tanstack/start-server-core";
import { auth } from "#/infra/auth/auth";
import { submitPrediction } from "#/routes/api/predictions/submit";

interface MatchListItem {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  kickoffUtc: string;
  status: string;
  locked: boolean;
}

interface LoaderData {
  matches: MatchListItem[];
  userId: string | null;
}

const getMatches = createServerFn({ method: "GET" }).handler(
  async (): Promise<LoaderData> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });
    const db = getDbClient();

    const lockOffsetMs = 5 * 60 * 1000;

    const result = await db.execute({
      sql: `SELECT id, home_team_id, away_team_id, kickoff_utc, status
            FROM match
            ORDER BY kickoff_utc ASC
            LIMIT 20`,
      args: [],
    });

    const matches: MatchListItem[] = result.rows.map((row) => {
      const kickoff = row["kickoff_utc"] as string;
      const kickoffMs = new Date(kickoff).getTime();
      const locked = Date.now() >= kickoffMs - lockOffsetMs;
      return {
        id: row["id"] as string,
        homeTeamId: row["home_team_id"] as string,
        awayTeamId: row["away_team_id"] as string,
        kickoffUtc: kickoff,
        status: row["status"] as string,
        locked,
      };
    });

    return { matches, userId: session?.user.id ?? null };
  }
);

export const Route = createFileRoute("/matches/")({
  loader: async () => {
    return await getMatches();
  },
  component: MatchListPage,
});

interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  label: string;
}

function ScoreStepper({ value, onChange, disabled = false, label }: StepperProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={disabled}
        className="w-11 h-11 rounded border text-lg font-bold flex items-center justify-center disabled:opacity-40"
        aria-label={`Decrease ${label}`}
      >
        −
      </button>
      <span className="w-8 text-center font-bold text-xl">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={disabled}
        className="w-11 h-11 rounded border text-lg font-bold flex items-center justify-center disabled:opacity-40"
        aria-label={`Increase ${label}`}
      >
        +
      </button>
    </div>
  );
}

function MatchCard({
  match,
  userId,
}: {
  match: MatchListItem;
  userId: string | null;
}) {
  const [homeGoals, setHomeGoals] = useState(0);
  const [awayGoals, setAwayGoals] = useState(0);
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "locked" | "error">(
    match.locked ? "locked" : "idle"
  );
  const navigate = useNavigate();

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
      if (result.locked) {
        setStatus("locked");
      } else {
        setStatus("done");
      }
    } catch {
      setStatus("error");
    }
  };

  return (
    <div
      className="p-4 border rounded mb-3"
      data-testid="match-card"
      data-match-id={match.id}
    >
      <div className="flex justify-between items-center mb-3">
        <span className="text-sm text-muted-foreground">
          {new Date(match.kickoffUtc).toLocaleString()}
        </span>
        {match.locked && (
          <span className="text-xs text-orange-500 font-medium" data-testid="match-locked">
            Locked
          </span>
        )}
      </div>
      <div className="flex items-center justify-center gap-4">
        <span className="font-medium w-24 text-right">{match.homeTeamId}</span>
        <ScoreStepper
          value={homeGoals}
          onChange={setHomeGoals}
          disabled={match.locked || status === "submitting"}
          label="home goals"
        />
        <span className="text-lg font-bold">:</span>
        <ScoreStepper
          value={awayGoals}
          onChange={setAwayGoals}
          disabled={match.locked || status === "submitting"}
          label="away goals"
        />
        <span className="font-medium w-24">{match.awayTeamId}</span>
      </div>
      {!match.locked && status !== "done" && (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={status === "submitting"}
          className="mt-3 w-full py-2 bg-primary text-primary-foreground rounded font-medium disabled:opacity-50"
          data-testid="submit-prediction"
        >
          {status === "submitting" ? "Saving…" : "Save prediction"}
        </button>
      )}
      {status === "done" && (
        <p className="mt-2 text-sm text-green-600" data-testid="prediction-saved">
          Prediction saved!
        </p>
      )}
      {status === "locked" && (
        <p className="mt-2 text-sm text-orange-500" data-testid="prediction-locked">
          Match is locked.
        </p>
      )}
    </div>
  );
}

function MatchListPage() {
  const { matches, userId } = Route.useLoaderData();

  if (matches.length === 0) {
    return (
      <div className="p-4" data-testid="no-matches">
        <h1 className="text-2xl font-bold mb-4">Matches</h1>
        <p className="text-muted-foreground">No matches scheduled yet.</p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-lg mx-auto" data-testid="match-list">
      <h1 className="text-2xl font-bold mb-4">Matches</h1>
      {matches.map((match) => (
        <MatchCard key={match.id} match={match} userId={userId} />
      ))}
    </div>
  );
}
