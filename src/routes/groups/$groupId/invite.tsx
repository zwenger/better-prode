/**
 * Route: /groups/$groupId/invite
 *
 * Invite link generation + copy button.
 * Server action revokes existing token on demand and generates a new one.
 *
 * Spec (groups): owner/admin can generate a shareable URL; revoke existing link on demand.
 *
 * Task 2.11.
 */

import { createFileRoute, useParams } from "@tanstack/react-router";
import { AppShell } from "#/components/app-shell";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { useState } from "react";
import { auth } from "#/infra/auth/auth";
import { getDb } from "#/infra/db/client";
import { DrizzleGroupRepository } from "#/adapters/db/group-repository";
import { DrizzleInvitationRepository } from "#/adapters/db/invitation-repository";
import { generateInviteToken, revokeInvite } from "#/domain/groups";

interface InviteInput {
  groupId: string;
  revokeFirst?: boolean;
}

interface InviteResult {
  inviteUrl: string;
  token: string;
}

const generateInviteLinkAction = createServerFn({ method: "POST" })
  .validator((data: unknown): InviteInput => data as InviteInput)
  .handler(async ({ data }): Promise<InviteResult> => {
    const request = getRequest();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    }

    const db = getDb();
    const groupRepo = new DrizzleGroupRepository(db);
    const invitationRepo = new DrizzleInvitationRepository(db);

    // Optionally revoke the existing active invite before generating a new one
    if (data.revokeFirst) {
      const existing = await invitationRepo.getActiveByGroup(data.groupId);
      if (existing) {
        await revokeInvite(
          { groupId: data.groupId, requesterId: session.user.id, invitationId: existing.id },
          groupRepo,
          invitationRepo
        );
      }
    }

    const { invitation } = await generateInviteToken(
      { groupId: data.groupId, requesterId: session.user.id },
      groupRepo,
      invitationRepo
    );

    // Build the absolute invite URL from the request origin
    const reqUrl = new URL(request.url);
    const inviteUrl = `${reqUrl.origin}/invite/${invitation.token}`;

    return { inviteUrl, token: invitation.token };
  });

export const Route = createFileRoute("/groups/$groupId/invite")({
  component: InvitePage,
});

function InvitePage() {
  const { groupId } = useParams({ from: "/groups/$groupId/invite" });
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async (revokeFirst = false) => {
    setLoading(true);
    setError(null);
    setCopied(false);

    try {
      const result = await generateInviteLinkAction({ data: { groupId, revokeFirst } });
      setInviteUrl(result.inviteUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al generar el enlace.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AppShell>
    <div className="p-4 max-w-sm mx-auto" data-testid="invite-page">
      <h1 className="text-2xl font-bold mb-2">Invitar al grupo</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Compartí el enlace con las personas que querés invitar.
      </p>

      {!inviteUrl ? (
        <button
          type="button"
          onClick={() => handleGenerate(false)}
          disabled={loading}
          className="w-full py-2 bg-primary text-primary-foreground rounded font-medium disabled:opacity-50"
          data-testid="generate-invite-btn"
        >
          {loading ? "Generando…" : "Generar enlace de invitación"}
        </button>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-3 border rounded bg-muted">
            <span className="text-sm truncate flex-1" data-testid="invite-url">
              {inviteUrl}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 px-3 py-1 text-sm border rounded hover:bg-accent"
              data-testid="copy-invite-btn"
            >
              {copied ? "¡Copiado!" : "Copiar"}
            </button>
          </div>

          <button
            type="button"
            onClick={() => handleGenerate(true)}
            disabled={loading}
            className="w-full py-1.5 text-sm border rounded hover:bg-accent disabled:opacity-50"
            data-testid="revoke-and-regenerate-btn"
          >
            {loading ? "Generando…" : "Revocar y generar nuevo enlace"}
          </button>
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-red-500" data-testid="invite-error">
          {error}
        </p>
      )}
    </div>
    </AppShell>
  );
}
