#!/usr/bin/env bash
# E2E server start script for Playwright tests.
# Starts a local libSQL server (turso dev) for E2E isolation,
# writes .dev.vars for Miniflare env var injection, builds the app,
# then starts the preview server (Miniflare/Workerd serving built output).
#
# Why preview (production build) instead of the dev server:
# E2E should exercise the exact artifact that ships. Preview serves the built
# output via Miniflare/Workerd, the same runtime as production.
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
# Apply ALL migrations in sorted order (do not hardcode files — new migrations
# like 0003 must be picked up automatically, else the E2E schema drifts from the
# Drizzle schema and `.select()` queries fail on missing columns).
for f in db/migrations/*.sql; do
  echo "[e2e-server]   applying $f"
  sqlite3 e2e.db < "$f"
done
sqlite3 e2e.db < db/seeds/e2e-fixture.sql
echo "[e2e-server] e2e.db initialized"

# Start local libSQL server for E2E tests.
turso dev --db-file e2e.db --port "$TURSO_PORT" &
TURSO_PID=$!
echo "$TURSO_PID" > "$TURSO_PID_FILE"
echo "[e2e-server] Started turso dev on port $TURSO_PORT (pid: $TURSO_PID)"

# Give turso dev a moment to start
sleep 2

# Build with e2e mode: VITE_TEST_AUTH_ENABLED=true so the test-auth bypass
# is included in this bundle (needed for Playwright auth injection).
# Production builds use `npm run build` which omits the bypass entirely.
npm run build:e2e

# Write E2E env vars directly to dist/server/.dev.vars.
# Miniflare (vite preview / @cloudflare/vite-plugin) reads secrets from there.
# We do NOT write or touch the root .dev.vars — that file holds real production
# secrets and must never be clobbered by test tooling.
mkdir -p dist/server
cat > dist/server/.dev.vars << EOF
TURSO_DATABASE_URL=http://127.0.0.1:${TURSO_PORT}
BETTER_AUTH_SECRET=test-secret-for-e2e-tests-only
TEST_AUTH_BYPASS=true
ADMIN_USER_IDS=test-admin-e2e-seed
EOF

echo "[e2e-server] dist/server/.dev.vars written for E2E run (root .dev.vars untouched)"

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
