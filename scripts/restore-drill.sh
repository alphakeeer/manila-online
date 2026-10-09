#!/usr/bin/env bash
# Dumps the live Compose database, restores it into an isolated database,
# and verifies that identity/game relations survived.
# Usage: COMPOSE_FILE=compose.prod.yaml scripts/restore-drill.sh
set -euo pipefail

# scripts/deploy.sh keeps secrets in .env.production; older manual setups use .env.
ENV_FILE="${MANILA_ENV_FILE:-$([[ -f .env.production ]] && echo .env.production || echo .env)}"
env_value() { [[ -f "$ENV_FILE" ]] && sed -n "s/^$1=//p" "$ENV_FILE" | head -1; }
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yaml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-$(env_value POSTGRES_USER)}"
SOURCE_DB="${SOURCE_DB:-${POSTGRES_DB:-$(env_value POSTGRES_DB)}}"
SOURCE_DB="${SOURCE_DB:-manila}"
DRILL_DB="${DRILL_DB:-manila_restore_drill}"
POSTGRES_USER="${POSTGRES_USER:?set POSTGRES_USER in the environment or .env}"
TABLES=(access_tokens sessions rooms room_members games commands events)

ENV_ARGS=(); [[ -f "$ENV_FILE" ]] && ENV_ARGS=(--env-file "$ENV_FILE")
CONTAINER="$(docker compose ${ENV_ARGS[@]+"${ENV_ARGS[@]}"} -f "$COMPOSE_FILE" ps -q "$POSTGRES_SERVICE")"
[[ -n "$CONTAINER" ]] || { echo "postgres container is not running for ${COMPOSE_FILE}" >&2; exit 1; }

TMP="$(mktemp -t manila-restore-drill-XXXXXX.dump)"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

db_exec() { docker exec "$CONTAINER" "$@"; }
count() { db_exec psql -U "$POSTGRES_USER" -d "$1" -tAc "SELECT count(*) FROM $2" | tr -d '[:space:]'; }

echo "1/4 dump ${SOURCE_DB} -> ${TMP}"
db_exec pg_dump -U "$POSTGRES_USER" -Fc "$SOURCE_DB" > "$TMP"

echo "2/4 recreate isolated database ${DRILL_DB}"
db_exec dropdb -U "$POSTGRES_USER" --if-exists "$DRILL_DB"
db_exec createdb -U "$POSTGRES_USER" "$DRILL_DB"

echo "3/4 restore"
docker exec -i "$CONTAINER" pg_restore -U "$POSTGRES_USER" -d "$DRILL_DB" --no-owner < "$TMP"

echo "4/4 verify row counts"
for table in "${TABLES[@]}"; do
  source_count="$(count "$SOURCE_DB" "$table")"
  drill_count="$(count "$DRILL_DB" "$table")"
  if [[ "$source_count" != "$drill_count" ]]; then
    echo "restore drill FAILED for ${table}: source=${source_count} drill=${drill_count}" >&2
    exit 1
  fi
  printf '  %-16s %s\n' "$table" "$source_count"
done
echo "restore drill passed: ${DRILL_DB} matches ${SOURCE_DB}"
echo "drop the drill database when finished: docker exec ${CONTAINER} dropdb -U ${POSTGRES_USER} ${DRILL_DB}"
