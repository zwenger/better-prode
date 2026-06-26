/**
 * Route: /groups/new
 *
 * Create group form + server action.
 *
 * Spec (groups): authenticated user submits a group name (1–60 chars);
 * on success, redirected to the group page (or groups index for MVP).
 *
 * Task 2.10.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "#/components/app-shell";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { useState } from "react";
import { auth } from "#/infra/auth/auth";
import { getDb } from "#/infra/db/client";
import { DrizzleGroupRepository } from "#/adapters/db/group-repository";
import { createGroup } from "#/domain/groups";

interface CreateGroupInput {
  name: string;
}

interface CreateGroupResult {
  groupId: string;
}

const createGroupAction = createServerFn({ method: "POST" })
  .validator((data: unknown): CreateGroupInput => {
    const raw = data as Record<string, unknown>;
    const name = raw["name"];
    if (typeof name !== "string" || name.trim().length === 0) {
      throw Object.assign(new Error("Group name is required"), { status: 400 });
    }
    if (name.length > 60) {
      throw Object.assign(new Error("Group name must not exceed 60 characters"), { status: 400 });
    }
    return { name: name.trim() };
  })
  .handler(async ({ data }): Promise<CreateGroupResult> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    }

    const db = getDb();
    const groupRepo = new DrizzleGroupRepository(db);

    const { group } = await createGroup(
      { name: data.name, ownerId: session.user.id },
      groupRepo
    );

    return { groupId: group.id };
  });

export const Route = createFileRoute("/groups/new")({
  component: NewGroupPage,
});

function NewGroupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg(null);

    try {
      const result = await createGroupAction({ data: { name } });
      // Redirect to the new group's members page
      navigate({ to: "/groups/$groupId/members", params: { groupId: result.groupId } });
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Error al crear el grupo.");
    }
  };

  return (
    <AppShell>
    <div className="p-4 max-w-sm mx-auto" data-testid="new-group-page">
      <h1 className="text-2xl font-bold mb-6">Crear grupo</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="group-name" className="block text-sm font-medium mb-1">
            Nombre del grupo
          </label>
          <input
            id="group-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="Ej: Los Campeones"
            className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            data-testid="group-name-input"
            required
          />
          <p className="text-xs text-muted-foreground mt-1">{name.length}/60 caracteres</p>
        </div>

        {errorMsg && (
          <p className="text-sm text-red-500" data-testid="create-group-error">
            {errorMsg}
          </p>
        )}

        <button
          type="submit"
          disabled={status === "submitting" || name.trim().length === 0}
          className="w-full py-2 bg-primary text-primary-foreground rounded font-medium disabled:opacity-50"
          data-testid="create-group-submit"
        >
          {status === "submitting" ? "Creando…" : "Crear grupo"}
        </button>
      </form>
    </div>
    </AppShell>
  );
}
