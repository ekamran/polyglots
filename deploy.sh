#!/usr/bin/env bash
# Builds the website and syncs it to the web server.
#
#   ./deploy.sh            build and deploy
#   ./deploy.sh --dry-run  build, then show what would change, transfer nothing
#
# Override with POLYGLOTS_DEPLOY_HOST / POLYGLOTS_DEPLOY_PATH / POLYGLOTS_DEPLOY_OWNER.

set -euo pipefail

HOST="${POLYGLOTS_DEPLOY_HOST:?set POLYGLOTS_DEPLOY_HOST}"
REMOTE_PATH="${POLYGLOTS_DEPLOY_PATH:?set POLYGLOTS_DEPLOY_PATH}"
OWNER="${POLYGLOTS_DEPLOY_OWNER:?set POLYGLOTS_DEPLOY_OWNER}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
SITE_DIR="$ROOT/website"

# A plain string, not an array: bash 3.2 (macOS) treats an empty array as
# unbound under `set -u`.
DRY=""
[ "${1:-}" = "--dry-run" ] && DRY="--dry-run"

# The site renders its terminal demos and command reference from app/src, which
# needs the app's dependencies. This script never installs them: `npm ci` in
# app/ runs `prepare`, which rebuilds app/dist, and a review or translate in
# flight spawns its MCP server from there. Installing is the person's call.
if [ ! -d "$ROOT/app/node_modules" ]; then
  echo "app/node_modules is missing. Run 'npm ci' in app/ yourself, then deploy again."
  exit 1
fi

cd "$SITE_DIR"
echo "==> Building"
npm ci
npm run build

# The pages agents and the app itself link to. A build that lost one of them
# must not replace a site that has it.
for f in index.html ai/index.html ai.txt llms.txt docs/antigravity/index.html docs/local-models/index.html; do
  [ -f "dist/$f" ] || { echo "dist/$f missing, aborting."; exit 1; }
done
# Every asset URL must carry the /polyglots base. One that does not works in
# `astro preview` and 404s on the server, so it is cheaper to catch here.
if grep -rqE '(src|href)="/(_astro|fonts)/' dist; then
  echo "An asset URL is missing the /polyglots base, aborting:"
  grep -rlE '(src|href)="/(_astro|fonts)/' dist
  exit 1
fi

echo "==> Syncing to $HOST:$REMOTE_PATH"
# --delete removes files the build no longer produces. Nothing else should
# live in that directory. og/ is the page the OG image is rendered from, and
# has no business being public.
rsync -avz --delete --human-readable ${DRY:+"$DRY"} \
  --exclude '.DS_Store' \
  --exclude 'og/' \
  dist/ "$HOST:$REMOTE_PATH"

# The Mac ships openrsync, which has no --chown, so set ownership over ssh.
if [ -n "$DRY" ]; then
  echo "==> Would chown -R $OWNER $REMOTE_PATH"
else
  echo "==> Setting owner to $OWNER"
  ssh "$HOST" "chown -R $OWNER '$REMOTE_PATH' && chmod -R u=rwX,go=rX '$REMOTE_PATH'"
fi

echo "==> Done: https://ada.tools/polyglots/"
