#!/usr/bin/env bash
# One-command production deploy on a single Linux host (Docker Engine + Compose v2).
#
#   scripts/deploy.sh --domain manila.example.com   # first deploy: secrets, build, start, health, first token
#   scripts/deploy.sh --update                      # after `git pull`: backup, rebuild, restart, health
#   scripts/deploy.sh --tokens 3                    # print 3 more access tokens
#   scripts/deploy.sh --local                       # rehearse on this machine at https://localhost (Caddy internal CA)
#
# Secrets live in .env.production (chmod 600, git-ignored). Back up AUTH_PEPPER separately.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="${MANILA_ENV_FILE:-.env.production}"
COMPOSE_FILE="compose.prod.yaml"
DOMAIN=""
TOKENS=""
UPDATE=0
LOCAL=0

say() { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }
usage() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:?--domain needs a value}"; shift 2 ;;
    --tokens) TOKENS="${2:?--tokens needs a number}"; shift 2 ;;
    --update) UPDATE=1; shift ;;
    --local) LOCAL=1; DOMAIN="localhost"; shift ;;
    -h|--help) usage 0 ;;
    *) warn "unknown option: $1"; usage 1 ;;
  esac
done
[[ -z "$TOKENS" || "$TOKENS" =~ ^[0-9]+$ ]] || die "--tokens must be a number"

command -v docker >/dev/null || die "Docker is not installed (https://docs.docker.com/engine/install/)"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (docker compose ...)"
docker info >/dev/null 2>&1 || die "Docker daemon is not reachable for this user"

random_hex() {
  if command -v openssl >/dev/null; then openssl rand -hex "$1"; else head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}
set_env() { # key value — replace or append in $ENV_FILE
  if grep -q "^$1=" "$ENV_FILE"; then sed -i.bak "s|^$1=.*|$1=$2|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"; else printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; fi
}

if [[ ! -f "$ENV_FILE" ]]; then
  [[ -n "$DOMAIN" ]] || die "first deploy needs --domain your.domain (or --local)"
  say "creating $ENV_FILE with fresh secrets"
  umask 077
  cp .env.production.example "$ENV_FILE"
  set_env POSTGRES_PASSWORD "$(random_hex 24)"
  set_env AUTH_PEPPER "$(random_hex 32)"
  set_env MANILA_IMAGE_TAG "$(date -u +%Y%m%d)"
fi
chmod 600 "$ENV_FILE"
if [[ -n "$DOMAIN" ]]; then
  set_env MANILA_DOMAIN "$DOMAIN"
  set_env ALLOWED_ORIGINS "https://$DOMAIN"
fi
if grep -q 'replace-with' "$ENV_FILE"; then die "$ENV_FILE still contains placeholder values"; fi

# Export for Compose interpolation and the backup script; nothing is echoed.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
DOMAIN="${MANILA_DOMAIN:?MANILA_DOMAIN missing in $ENV_FILE}"
[[ "$DOMAIN" == "localhost" ]] && LOCAL=1
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

if [[ $UPDATE -eq 1 ]] && [[ -n "$("${COMPOSE[@]}" ps -q postgres 2>/dev/null)" ]]; then
  say "backing up the database before the update"
  MANILA_ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" scripts/backup-db.sh "backup/manila-before-update-$(date -u +%Y%m%dT%H%M%SZ).dump"
fi

say "building and starting (this takes a few minutes the first time)"
"${COMPOSE[@]}" up -d --build

say "waiting for the app to become ready"
ready=0
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T app node -e "fetch('http://127.0.0.1:3000/health/ready').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[[ $ready -eq 1 ]] || { "${COMPOSE[@]}" logs --tail 40 app >&2; die "app did not become ready; see the logs above"; }

CURL_FLAGS=(-fsS --max-time 5)
[[ $LOCAL -eq 1 ]] && CURL_FLAGS+=(-k)
say "checking https://$DOMAIN (certificates can take a minute on first start)"
public=0
for _ in $(seq 1 45); do
  if curl "${CURL_FLAGS[@]}" "https://$DOMAIN/health/ready" >/dev/null 2>&1; then public=1; break; fi
  sleep 2
done
if [[ $public -eq 0 ]]; then
  warn "https://$DOMAIN is not reachable yet. Check: DNS A/AAAA record points here, ports 80/443 open, then: ${COMPOSE[*]} logs caddy"
fi

create_tokens() {
  local count="$1"
  say "access tokens (each shown once — send them to friends privately):"
  for index in $(seq 1 "$count"); do
    "${COMPOSE[@]}" exec -T app node --import tsx apps/server/scripts/tokens.ts create "friends-$(date -u +%Y%m%d)-$index" | sed -n 's/^Token: /  /p'
  done
}
if [[ -n "$TOKENS" ]]; then create_tokens "$TOKENS"
elif ! "${COMPOSE[@]}" exec -T app node --import tsx apps/server/scripts/tokens.ts list | grep -q $'\tactive\t'; then
  # No working token yet (first deploy, or a first run that stopped early): issue one.
  create_tokens 1
fi

cat <<EOF

  Manila is up:   https://$DOMAIN
  Invite friends: send the token, then share the room link from the lobby (copy / QR).
  Update later:   git pull && scripts/deploy.sh --update
  More tokens:    scripts/deploy.sh --tokens 2
  Self-check:     PUBLIC_BASE_URL=https://$DOMAIN npm run verify:deployment$([[ $LOCAL -eq 1 ]] && printf ' (ALLOW_INSECURE=1 for --local)')
  Back up:        $ENV_FILE (AUTH_PEPPER!) and scripts/backup-db.sh dumps — off this machine.

EOF
