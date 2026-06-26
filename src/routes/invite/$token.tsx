/**
 * Route: /invite/$token
 *
 * Join-via-link page. On load, shows group name and a join button.
 * Server action validates the token, creates membership, redirects to group.
 *
 * Spec (groups): valid token → show group name + join prompt; on join, create
 * GroupMembership with role "member"; invalid/revoked token → "invalid invite".
 *
 * Task 2.12.
 */

import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { useState } from "react";
import { auth } from "#/infra/auth/auth";
import { authClient } from "#/infra/auth/auth-client";
import { getDb } from "#/infra/db/client";
import { DrizzleGroupRepository } from "#/adapters/db/group-repository";
import { DrizzleInvitationRepository } from "#/adapters/db/invitation-repository";
import { joinViaToken } from "#/domain/groups";

interface InviteInfo {
  groupId: string;
  groupName: string;
  token: string;
}

interface JoinInput {
  token: string;
}

/** Server function: load invite info (group name) for display. */
const getInviteInfo = createServerFn({ method: "GET", strict: false })
  .validator((data: unknown): JoinInput => data as JoinInput)
  .handler(async ({ data }): Promise<InviteInfo | null> => {
    const db = getDb();
    const invitationRepo = new DrizzleInvitationRepository(db);
    const groupRepo = new DrizzleGroupRepository(db);

    const invitation = await invitationRepo.getByToken(data.token);
    if (!invitation || invitation.status !== "pending") {
      return null;
    }

    const group = await groupRepo.getById(invitation.groupId);
    if (!group) return null;

    return { groupId: group.id, groupName: group.name, token: data.token };
  });

/** Server function: join the group via the invite token. */
const joinGroupAction = createServerFn({ method: "POST" })
  .validator((data: unknown): JoinInput => data as JoinInput)
  .handler(async ({ data }): Promise<{ groupId: string }> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    }

    const db = getDb();
    const groupRepo = new DrizzleGroupRepository(db);
    const invitationRepo = new DrizzleInvitationRepository(db);

    const invitation = await invitationRepo.getByToken(data.token);
    if (!invitation) {
      throw Object.assign(new Error("invalid_token"), { status: 404 });
    }

    const { membership } = await joinViaToken(
      { token: data.token, userId: session.user.id },
      groupRepo,
      invitationRepo
    );

    return { groupId: membership.groupId };
  });

export const Route = createFileRoute("/invite/$token")({
  loader: async ({ params }) => {
    return getInviteInfo({ data: { token: params["token"] } });
  },
  component: InvitePage,
});

function InvitePage() {
  const { token } = useParams({ from: "/invite/$token" });
  const inviteInfo = Route.useLoaderData();
  const navigate = useNavigate();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: session } = authClient.useSession();

  if (!inviteInfo) {
    return (
      <div className="p-4 max-w-sm mx-auto" data-testid="invalid-invite">
        <h1 className="text-2xl font-bold mb-2">Enlace inválido</h1>
        <p className="text-muted-foreground">
          Este enlace de invitación no es válido o ya fue utilizado.
        </p>
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div className="p-4 max-w-sm mx-auto" data-testid="invite-login-prompt">
        <h1 className="text-2xl font-bold mb-2">Unirse al grupo</h1>
        <p className="text-muted-foreground mb-6">
          Para unirte a{" "}
          <span className="font-semibold text-foreground" data-testid="invite-group-name">
            {inviteInfo.groupName}
          </span>
          , necesitás iniciar sesión.
        </p>
        <button
          type="button"
          onClick={() =>
            authClient.signIn.social({ provider: "google", callbackURL: `/invite/${token}` })
          }
          className="w-full py-2 bg-primary text-primary-foreground rounded font-medium"
          data-testid="invite-sign-in-btn"
        >
          Iniciar sesión con Google
        </button>
      </div>
    );
  }

  const handleJoin = async () => {
    setJoining(true);
    setError(null);

    try {
      const result = await joinGroupAction({ data: { token } });
      navigate({ to: "/groups/$groupId/members", params: { groupId: result.groupId } });
    } catch (err) {
      if (err instanceof Error && err.message.includes("already_member")) {
        setError("Ya sos miembro de este grupo.");
      } else {
        setError(err instanceof Error ? err.message : "Error al unirte al grupo.");
      }
      setJoining(false);
    }
  };

  return (
    <div className="p-4 max-w-sm mx-auto" data-testid="invite-join-page">
      <h1 className="text-2xl font-bold mb-2">Unirse al grupo</h1>
      <p className="text-muted-foreground mb-6">
        Te invitaron a unirte a{" "}
        <span className="font-semibold text-foreground" data-testid="invite-group-name">
          {inviteInfo.groupName}
        </span>
        .
      </p>

      {error && (
        <p className="mb-4 text-sm text-red-500" data-testid="join-error">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleJoin}
        disabled={joining}
        className="w-full py-2 bg-primary text-primary-foreground rounded font-medium disabled:opacity-50"
        data-testid="join-group-btn"
      >
        {joining ? "Uniéndome…" : "Unirme al grupo"}
      </button>
    </div>
  );
}
