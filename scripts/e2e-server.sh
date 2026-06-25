#!/usr/bin/env bash
# E2E server start script for Playwright tests.
# Starts a local libSQL server (turso dev) for E2E isolation,
# writes .dev.vars for Miniflare env var injection, builds the app,
# then starts the preview server (Miniflare/Workerd serving built output).
#
# Why preview instead of dev:
# @cloudflare/vite-plugin SSR dep-optimization in dev mode fails to resolve
# #tanstack-router-entry package import maps from @tanstack/start-server-core.
# Preview uses the production build without dep-opt and is fully functional.
#
# Why turso dev instead of file:// URL:
# @libsql/client in the Cloudflare Workers runtime uses the web client
# (workerd condition), which only supports libsql://, http://, https://,
# ws://, wss:// URLs. file:// URLs are not supported in workerd.
# `turso dev` provides a local HTTP libSQL server that the web client can reach.

set -e

cd "$(dirname "$0")/.."

TURSO_PORT=8081
TURSO_PID_FILE="/tmp/turso-e2e-$$.pid"

# Initialize the E2E SQLite database with schema and seed data.
# Remove stale DB to ensure a clean state on each run.
rm -f e2e.db

echo "[e2e-server] Initializing e2e.db with migrations and seed..."
sqlite3 e2e.db < db/migrations/0001_init.sql
sqlite3 e2e.db < db/migrations/0002_better_auth_tables.sql
sqlite3 e2e.db < db/seeds/e2e-fixture.sql
echo "[e2e-server] e2e.db initialized"

# Start local libSQL server for E2E tests.
turso dev --db-file e2e.db --port "$TURSO_PORT" &
TURSO_PID=$!
echo "$TURSO_PID" > "$TURSO_PID_FILE"
echo "[e2e-server] Started turso dev on port $TURSO_PORT (pid: $TURSO_PID)"

# Give turso dev a moment to start
sleep 2

# Write .dev.vars so Miniflare (vite preview) picks up E2E config.
# TURSO_DATABASE_URL points to the local turso dev server.
cat > .dev.vars << EOF
TURSO_DATABASE_URL=http://127.0.0.1:${TURSO_PORT}
BETTER_AUTH_SECRET=test-secret-for-e2e-tests-only
TEST_AUTH_BYPASS=true
ADMIN_USER_IDS=test-admin-e2e-seed
EOF

echo "[e2e-server] .dev.vars written for E2E run"

# Build with e2e mode: VITE_TEST_AUTH_ENABLED=true so the test-auth bypass
# is included in this bundle (needed for Playwright auth injection).
# Production builds use `npm run build` which omits the bypass entirely.
npm run build:e2e

# Miniflare (vite preview / @cloudflare/vite-plugin) reads secrets from
# dist/server/.dev.vars. The vite build already copies .dev.vars there,
# but copy explicitly in case build uses a cached output.
cp .dev.vars dist/server/.dev.vars
echo "[e2e-server] .dev.vars copied to dist/server/.dev.vars for Miniflare"

# Cleanup turso dev on exit
cleanup() {
  if [ -f "$TURSO_PID_FILE" ]; then
    TPID=$(cat "$TURSO_PID_FILE")
    kill "$TPID" 2>/dev/null || true
    rm -f "$TURSO_PID_FILE"
    echo "[e2e-server] turso dev stopped"
  fi
}
trap cleanup EXIT

# Start preview server (Miniflare serving ./dist)
exec npm run preview
