#!/usr/bin/env bash
#
# Execute the migrations against a real Postgres and prove the RLS policies hold.
#
# A migration that has only ever been read is a migration that has never been
# checked, and the anon key shipped in the app bundle is safe only because these
# policies work. This runs the real SQL against a real server, then acts as two
# different signed-in users — and as a signed-out one — to confirm the isolation.
#
# Usage:
#   supabase/test/verify.sh [database-name]
#
# Connects one of two ways:
#   * PGHOST set (CI, or any TCP server) — uses psql with the standard PG* vars.
#   * otherwise — falls back to a local cluster via `sudo -u postgres`.
set -euo pipefail

DB="${1:-repurpose_verify}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ -n "${PGHOST:-}" ]]; then
  PSQL=(psql -v ON_ERROR_STOP=1 --quiet)
  MAINT_DB="${PGDATABASE:-postgres}"
else
  PSQL=(sudo -u postgres psql -v ON_ERROR_STOP=1 --quiet)
  MAINT_DB="postgres"
fi

run_sql() { "${PSQL[@]}" -d "$1" "${@:2}"; }

echo "==> Recreating database: $DB"
run_sql "$MAINT_DB" -c "drop database if exists $DB;" >/dev/null
run_sql "$MAINT_DB" -c "create database $DB;" >/dev/null

echo "==> Installing the Supabase auth shim"
run_sql "$DB" -f "$ROOT/supabase/test/auth_shim.sql" >/dev/null

echo "==> Applying migrations"
for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "    $(basename "$migration")"
  run_sql "$DB" -f "$migration" >/dev/null
done

echo "==> Checking RLS is enabled on every table holding user data"
UNPROTECTED="$(run_sql "$DB" -t -A -c "
  select coalesce(string_agg(relname, ', '), '')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname <> 'exercises'      -- the shared movement catalog holds no user data
    and not c.relrowsecurity;
")"

if [[ -n "$UNPROTECTED" ]]; then
  echo "FAIL: tables without RLS: $UNPROTECTED"
  exit 1
fi
echo "    every user table has RLS enabled"

echo "==> Running RLS isolation tests"
run_sql "$DB" -f "$ROOT/supabase/test/rls_test.sql"

echo ""
echo "==> Schema applies cleanly and RLS isolates users."
