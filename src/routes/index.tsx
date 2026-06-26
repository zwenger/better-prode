import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { auth } from "#/infra/auth/auth";
import { authClient } from "#/infra/auth/auth-client";

const getSession = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  return { user: session?.user ?? null };
});

export const Route = createFileRoute("/")({
  loader: async () => {
    const { user } = await getSession();
    if (user) throw redirect({ to: "/today" });
    return {};
  },
  component: Home,
});

function Home() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "var(--surface)",
        padding: "1.5rem",
      }}
      data-testid="home-page"
    >
      <h1
        style={{
          fontFamily: "Archivo, system-ui, sans-serif",
          fontWeight: 800,
          fontSize: "clamp(1.75rem, 5vw, 2.75rem)",
          color: "var(--pitch-green)",
          letterSpacing: "-0.02em",
          margin: 0,
          lineHeight: 1.1,
        }}
      >
        better·prode
      </h1>

      <div
        data-testid="login-prompt"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "1.5rem",
          marginTop: "1rem",
          width: "100%",
          maxWidth: "320px",
        }}
      >
        <p
          style={{
            fontFamily: "Inter, system-ui, sans-serif",
            fontWeight: 400,
            fontSize: "0.9375rem",
            color: "var(--ink-muted)",
            margin: 0,
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          Predicí los partidos del Mundial con tus amigos.
        </p>

        <hr
          style={{
            width: "2rem",
            border: "none",
            borderTop: "2px solid var(--pitch-green-tint)",
            margin: 0,
          }}
        />

        <button
          type="button"
          onClick={() =>
            authClient.signIn.social({
              provider: "google",
              callbackURL: "/",
            })
          }
          style={{
            width: "100%",
            height: "44px",
            backgroundColor: "var(--pitch-green)",
            color: "var(--surface)",
            fontFamily: "Inter, system-ui, sans-serif",
            fontWeight: 600,
            fontSize: "0.9375rem",
            border: "none",
            borderRadius: "12px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            outline: "none",
          }}
          onFocus={(e) => {
            e.currentTarget.style.boxShadow =
              "0 0 0 3px var(--pitch-green-tint)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.boxShadow = "none";
          }}
          data-testid="sign-in-google"
        >
          Iniciar sesión con Google
        </button>
      </div>
    </div>
  );
}
