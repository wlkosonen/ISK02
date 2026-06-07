#!/usr/bin/env bash
#
# aether-update.sh — nightly git watcher + Docker rebuild/restart for ISK02 (Aether).
#
# Canonical, version-controlled copy of the deploy-server watcher. Point your
# systemd unit's ExecStart at THIS file so the watcher itself stays up to date on
# every pull. Pairs with aether-update.service / aether-update.timer (03:30 daily).
#
# What it does: fetch origin; if origin/<branch> moved, hard-reset to it, rebuild
# the container, and prune dangling images + build cache so the disk doesn't fill.
# It NEVER touches .env, so server-side secrets/overrides (API keys, OLLAMA_BASE_URL)
# survive the reset — keep your deploy config in .env, not in tracked files.
set -euo pipefail

# ==================== CONFIGURATION ====================
DEPLOY_DIR="${1:-/home/shegs/docker/aether}"
BRANCH="main"
# Leave empty unless you use compose overrides (e.g. "-f docker-compose.yml -f docker-compose.prod.yml")
COMPOSE_FILE_ARGS=""
# =======================================================

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$*"; }
die() { log "ERROR: $*"; exit 1; }

log "=== Aether nightly watcher starting ==="

[ -d "$DEPLOY_DIR" ] || die "Deploy dir not found: $DEPLOY_DIR"
cd "$(realpath "$DEPLOY_DIR")" || die "cd failed"

log "Working directory: $(pwd)"
log "Current local commit: $(git rev-parse --short HEAD)"

git fetch origin --quiet || die "git fetch failed"

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/${BRANCH}" 2>/dev/null || git rev-parse "origin/HEAD" 2>/dev/null || echo "")
[ -n "$REMOTE" ] || die "Could not resolve remote ref"

if [ "$LOCAL" = "$REMOTE" ]; then
  log "No changes on origin/${BRANCH}. Local is up to date."
  log "=== Aether watcher finished (no-op) ==="
  exit 0
fi

log ">>> Changes detected on remote!"
log "    Local : $LOCAL"
log "    Remote: $REMOTE"

log "Hard reset to origin/${BRANCH}..."
git reset --hard "origin/${BRANCH}"
# Wipe untracked cruft but PRESERVE any .env files (server secrets / overrides).
git clean -fdx --exclude='.env' --exclude='*.env*' || true

log "docker compose down..."
docker compose ${COMPOSE_FILE_ARGS} down --remove-orphans || log "WARN: down had issues (continuing)"

log "docker compose up -d --build..."
docker compose ${COMPOSE_FILE_ARGS} up -d --build || die "compose up failed"

# Reclaim disk: each --build leaves dangling image layers + build cache behind.
# Without this the deploy disk slowly fills (the box was already at ~89%).
log "Pruning dangling images + build cache..."
docker image prune -f   || log "WARN: image prune failed (continuing)"
docker builder prune -f  || log "WARN: builder prune failed (continuing)"

log "Now at: $(git rev-parse --short HEAD)"
log "=== Aether watcher finished (rebuilt) ==="
