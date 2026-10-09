#!/usr/bin/env bash
# Backs up the Manila PostgreSQL database from a Compose deployment.
# Usage: scripts/backup-db.sh [output-file]
set -euo pipefail

# scripts/deploy.sh keeps secrets in .env.production; older manual setups use .env.
ENV_FILE="${MANILA_ENV_FILE:-$([[ -f .env.production ]] && echo .env.production || echo .env)}"
env_value() { [[ -f "$ENV_FILE" ]] && sed -n "s/^$1=//p" "$ENV_FILE" | head -1; }
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yaml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-$(env_value POSTGRES_USER)}"
SOURCE_DB="${SOURCE_DB:-${POSTGRES_DB:-$(env_value POSTGRES_DB)}}"
SOURCE_DB="${SOURCE_DB:-manila}"
POSTGRES_USER="${POSTGRES_USER:?set POSTGRES_USER in the environment or .env}"

ENV_ARGS=(); [[ -f "$ENV_FILE" ]] && ENV_ARGS=(--env-file "$ENV_FILE")
CONTAINER="$(docker compose ${ENV_ARGS[@]+"${ENV_ARGS[@]}"} -f "$COMPOSE_FILE" ps -q "$POSTGRES_SERVICE")"
[[ -n "$CONTAINER" ]] || { echo "postgres container is not running for ${COMPOSE_FILE}" >&2; exit 1; }

OUTPUT="${1:-backup/manila-$(date -u +%Y%m%dT%H%M%SZ).dump}"
mkdir -p "$(dirname "$OUTPUT")"

docker exec "$CONTAINER" pg_dump -U "$POSTGRES_USER" -Fc "$SOURCE_DB" > "$OUTPUT"

echo "backup written: $OUTPUT ($(wc -c < "$OUTPUT") bytes)"
echo "keep AUTH_PEPPER in a separate secret backup; the dump alone cannot validate existing sessions/tokens."
