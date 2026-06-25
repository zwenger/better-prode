import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { auth } from "#/infra/auth/auth";

const getSession = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const session = await auth.api.getSession({ headers: request.headers });
  return { user: session?.user ?? null };
});

export const Route = createFileRoute("/")({
  loader: async () => getSession(),
  component: Home,
});

function Home() {
  const { user } = Route.useLoaderData();

  return (
    <div className="p-8 max-w-lg mx-auto" data-testid="home-page">
      <h1 className="text-4xl font-bold mb-4">Better Prode</h1>
      {user ? (
        <div>
          <p className="mb-4" data-testid="welcome-user">
            Welcome, <strong>{user.name || user.email}</strong>!
          </p>
          <nav className="space-y-2">
            <Link
              to="/matches"
              className="block px-4 py-2 bg-primary text-primary-foreground rounded text-center"
              data-testid="nav-matches"
            >
              View Matches
            </Link>
          </nav>
        </div>
      ) : (
        <div>
          <p className="mb-4 text-muted-foreground" data-testid="login-prompt">
            Sign in to start predicting match scores.
          </p>
          <a
            href="/api/auth/sign-in/google"
            className="block px-4 py-2 bg-primary text-primary-foreground rounded text-center"
            data-testid="sign-in-google"
          >
            Sign in with Google
          </a>
        </div>
      )}
    </div>
  );
}
