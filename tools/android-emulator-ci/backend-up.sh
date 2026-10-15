#!/usr/bin/env bash
# CI-ONLY. Brings up the throwaway test backend for ONE matrix leg:
#   Postgres 16 service container (superuser = job-local container only)
#   -> real EF migrations as superuser (--migrate-only, Staging)
#   -> demo fixture seed (superuser API instance, once)
#   -> extra roles + second farm (SQL), objects re-owned to the NON-superuser agrisync_app
#   -> API restarted as agrisync_app (row level security is real), roster added through the API.
# No repository secrets. Every credential below is generated inside this job and masked.
set -euo pipefail

: "${PG_PORT:?}" "${PG_SUPER_PW:?}" "${API_PORT:?}" "${API_DIR:?}" "${CI_WORK:?}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${APP_SRC:-$(cd "$HERE/../.." && pwd)}"
mkdir -p "$CI_WORK"
DB=agrisync_ci
SUPER_URL="postgresql://postgres:${PG_SUPER_PW}@127.0.0.1:${PG_PORT}/postgres"
EVIDENCE_PG_URL="postgresql://postgres:${PG_SUPER_PW}@127.0.0.1:${PG_PORT}/${DB}"

APP_PW="$(openssl rand -hex 16)"
RO_PW="$(openssl rand -hex 16)"
JWT_KEY="$(openssl rand -hex 32)"
IP_SALT="$(openssl rand -base64 48 | tr -d '\n')"
for s in "$APP_PW" "$RO_PW" "$JWT_KEY" "$IP_SALT"; do echo "::add-mask::$s"; done

# The demo password is the fixture's own, public in the repo (PurveshDemoSeeder.cs). Read it from there so
# there is one source of truth and no copy of it in this workflow.
DEMO_PASSWORD="$(sed -nE 's/.*new\("purvesh", *"[^"]*", *"8888888888", *"([^"]+)".*/\1/p' "$REPO/src/AgriSync.Bootstrapper/Infrastructure/PurveshDemoSeeder.cs" | head -1)"
[ -n "$DEMO_PASSWORD" ] || { echo "::error::could not read the demo fixture password from PurveshDemoSeeder.cs"; exit 1; }
echo "::add-mask::$DEMO_PASSWORD"

echo "== waiting for postgres"
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" -U postgres >/dev/null 2>&1 && break; sleep 2; done
pg_isready -h 127.0.0.1 -p "$PG_PORT" -U postgres
psql "$SUPER_URL" -X -v ON_ERROR_STOP=1 -c "select version()" -At
psql "$SUPER_URL" -X -v ON_ERROR_STOP=1 -c "drop database if exists ${DB}" -c "create database ${DB}"

conn() { # $1 = user, $2 = password
  echo "Host=127.0.0.1;Port=${PG_PORT};Database=${DB};Username=$1;Password=$2;Include Error Detail=true"
}
SUPER_CS="$(conn postgres "$PG_SUPER_PW")"

common_env() {
  export Jwt__SigningKey="$JWT_KEY" Audit__IpHashSalt="$IP_SALT" BUILD_SHA="${GITHUB_SHA:0:8}-android-ci"
  export ALLOW_E2E_SEED=true TestFixtures__AllowRuntimeReset=true TestFixtures__AllowRuntimeSeed=true
  export Cors__AllowedOrigins__0="https://localhost" Cors__AllowedOrigins__1="http://localhost"
  export OTel__Endpoint=""
  export ASPNETCORE_URLS="http://127.0.0.1:${API_PORT}"
}
cs_env() { # $1 = app connection string, $2 = readonly connection string
  export ConnectionStrings__UserDb="$1" ConnectionStrings__ShramSafalDb="$1"
  export ConnectionStrings__UserDb_Migration="$SUPER_CS" ConnectionStrings__ShramSafalDb_Migration="$SUPER_CS"
  export ConnectionStrings__UserDb_ReadOnly="$2" ConnectionStrings__ShramSafalDb_ReadOnly="$2"
}

echo "== migrate (real EF migrations, superuser, Staging, no hosted services)"
( cd "$API_DIR"; common_env; cs_env "$SUPER_CS" "$SUPER_CS"; ASPNETCORE_ENVIRONMENT=Staging dotnet AgriSync.Bootstrapper.dll --migrate-only ) 2>&1 | tail -n 25 | tee "$CI_WORK/migrate.tail.log"
psql "$EVIDENCE_PG_URL" -X -At -c "select 'ssf migrations applied: ' || count(*) from ssf.\"__EFMigrationsHistory\"" || true

wait_ready() {
  for i in $(seq 1 60); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${API_PORT}/health/ready" || true)"
    [ "$code" = "200" ] && { echo "API ready after ${i} polls"; return 0; }
    sleep 2
  done
  echo "::error::API not ready; last log lines:"; tail -n 60 "$CI_WORK/api.log" || true; return 1
}
start_api() { # $1 = label, $2 = app cs, $3 = ro cs
  ( cd "$API_DIR"; common_env; cs_env "$2" "$3"; ASPNETCORE_ENVIRONMENT=Development \
      nohup dotnet AgriSync.Bootstrapper.dll > "$CI_WORK/api.$1.log" 2>&1 & echo $! > "$CI_WORK/api.pid" )
  ln -sf "$CI_WORK/api.$1.log" "$CI_WORK/api.log"
}
stop_api() { [ -f "$CI_WORK/api.pid" ] && kill "$(cat "$CI_WORK/api.pid")" 2>/dev/null || true; sleep 3; rm -f "$CI_WORK/api.pid"; }

echo "== seed the demo fixture (superuser instance, once)"
start_api seed "$SUPER_CS" "$SUPER_CS"; wait_ready
curl -sS -X POST "http://127.0.0.1:${API_PORT}/__e2e/seed" -H 'Content-Type: application/json' -d '{"fixture":"purvesh-demo"}' | tee "$CI_WORK/seed.json" | head -c 600; echo
grep -q '"seeded":true' "$CI_WORK/seed.json" || { echo "::error::fixture seed failed"; tail -n 60 "$CI_WORK/api.log"; exit 1; }
stop_api

echo "== extra roles + second farm; hand objects to the non-superuser role"
psql "$EVIDENCE_PG_URL" -X -v ON_ERROR_STOP=1 -f "$HERE/sql/01-extra-roles.sql"
psql "$EVIDENCE_PG_URL" -X -v ON_ERROR_STOP=1 -f "$HERE/sql/02-own-objects.sql"
psql "$EVIDENCE_PG_URL" -X -v ON_ERROR_STOP=1 -c "alter role agrisync_app password '${APP_PW}'" -c "alter role agrisync_readonly password '${RO_PW}'"
psql "$EVIDENCE_PG_URL" -X -At -c "select rolname || ' super=' || rolsuper || ' bypassrls=' || rolbypassrls || ' login=' || rolcanlogin from pg_roles where rolname like 'agrisync_%' order by 1" | tee "$CI_WORK/roles.txt"
grep -q 'agrisync_app super=false bypassrls=false login=true' "$CI_WORK/roles.txt" || { echo "::error::agrisync_app is not a plain non-superuser login role"; exit 1; }

echo "== serve as the NON-superuser agrisync_app"
APP_CS="$(conn agrisync_app "$APP_PW")"; RO_CS="$(conn agrisync_readonly "$RO_PW")"
start_api app "$APP_CS" "$RO_CS"; wait_ready
export API_BASE="http://127.0.0.1:${API_PORT}" DEMO_PASSWORD EVIDENCE_PG_URL
( cd "$HERE" && node seed-api.mjs ) | tee "$CI_WORK/seed-api.json"
psql "$EVIDENCE_PG_URL" -X -At -c "select usename || ' x' || count(*) from pg_stat_activity where datname='${DB}' and usename is not null group by usename order by 1" | tee "$CI_WORK/pg-connections.txt"
grep -q '^agrisync_app ' "$CI_WORK/pg-connections.txt" || { echo "::error::API is not connected as agrisync_app"; exit 1; }
curl -sS "http://127.0.0.1:${API_PORT}/version" | tee "$CI_WORK/version.json"; echo

# Values the driver needs (secrets stay in this job; masked above).
{
  echo "API_BASE=${API_BASE}"
  echo "EVIDENCE_PG_URL=${EVIDENCE_PG_URL}"
  echo "DEMO_PASSWORD=${DEMO_PASSWORD}"
  echo "API_LOG=${CI_WORK}/api.log"
} > "$CI_WORK/ci.env"
chmod 600 "$CI_WORK/ci.env"
echo "backend up"
