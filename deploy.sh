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

# rsync --delete and chown -R both act on REMOTE_PATH as a whole. Pointed one
# level up, at the directory holding every site, they would delete and re-own every other site
# on the host. So the path must be absolute, free of anything that climbs out
# of it, and name the polyglots directory itself.
case "$REMOTE_PATH" in
  /*) ;;
  *) echo "POLYGLOTS_DEPLOY_PATH must be absolute, got '$REMOTE_PATH'."; exit 1 ;;
esac
case "$REMOTE_PATH" in
  *..*|*//*|*' '*) echo "POLYGLOTS_DEPLOY_PATH must not contain '..', '//' or spaces, got '$REMOTE_PATH'."; exit 1 ;;
esac
REMOTE_PATH="${REMOTE_PATH%/}/"
case "$REMOTE_PATH" in
  */polyglots/) ;;
  *) echo "POLYGLOTS_DEPLOY_PATH must end in /polyglots/, got '$REMOTE_PATH'. Refusing to rsync --delete anywhere else."; exit 1 ;;
esac
# The host goes into rsync and ssh as a destination; anything that looks like
# an option or carries a path or a command is a typo at best.
case "$HOST" in
  -*|*[!A-Za-z0-9._@-]*) echo "POLYGLOTS_DEPLOY_HOST looks wrong: '$HOST'."; exit 1 ;;
esac

case "$OWNER" in
  *[!A-Za-z0-9._:-]*) echo "POLYGLOTS_DEPLOY_OWNER looks wrong: '$OWNER'."; exit 1 ;;
esac

# The site renders its terminal demos and command reference from app/src, which
# needs the app's dependencies. This script never installs them: `npm ci` in
# app/ runs `prepare`, which rebuilds app/dist, and a review or translate in
# flight spawns its MCP server from there. Installing is the person's call.
if [ ! -d "$ROOT/app/node_modules" ]; then
  echo "app/node_modules is missing. Run 'npm ci' in app/ yourself, then deploy again."
  exit 1
fi

COMMIT="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "==> Deploying $COMMIT"
# Not a refusal: a docs typo fixed and deployed before it is committed is a
# normal thing to do. But the site then shows something no commit holds.
if [ -n "$(git -C "$ROOT" status --porcelain -- website docs app/src 2>/dev/null)" ]; then
  echo "    Warning: uncommitted changes in website/, docs/ or app/src/ will be deployed too."
fi

cd "$SITE_DIR"
echo "==> Building"
npm ci
npm test
npm run build

# The pages agents and the app itself link to. A build that lost one of them
# must not replace a site that has it.
for f in index.html ai/index.html ai.txt llms.txt docs/antigravity/index.html docs/local-models/index.html; do
  [ -f "dist/$f" ] || { echo "dist/$f missing, aborting."; exit 1; }
done
# Every root-relative URL must carry the /polyglots base. One that does not
# works in `astro preview` and 404s on the server, so it is cheaper to catch
# here: attributes in HTML, url() in CSS, inline or in a stylesheet.
BAD_ATTR='(src|href|srcset|content|action)="/([^/p]|p[^o]|$)|(src|href|srcset|content|action)="/(po[^l]|pol[^y]|poly[^g]|polyg[^l]|polygl[^o]|polyglo[^t]|polyglot[^s]|polyglots[^/"])'
BAD_URL='url\(["'"'"']?/([^/p]|p[^o]|po[^l]|pol[^y]|poly[^g]|polyg[^l]|polygl[^o]|polyglo[^t]|polyglot[^s]|polyglots[^/])'
if grep -rqE "$BAD_ATTR" --include='*.html' dist || grep -rqE "$BAD_URL" --include='*.html' --include='*.css' dist; then
  echo "A root-relative URL is missing the /polyglots base, aborting:"
  grep -rnoE "$BAD_ATTR" --include='*.html' dist | head
  grep -rnoE "$BAD_URL" --include='*.html' --include='*.css' dist | head
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

echo "==> Done: https://ada.tools/polyglots/ ($COMMIT)"
