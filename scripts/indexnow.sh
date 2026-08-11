#!/usr/bin/env bash
# scripts/indexnow.sh — submit recently-changed URLs from this repo's sitemap to IndexNow.
#
# This wrapper does NOT filter the sitemap itself. It used to (a local Python
# regex block filtering by <lastmod>), and that second implementation of the
# filtering the shared script now owns is what let a stale sitemap collapse to
# a silent "nothing to submit, exit 0" for months — indistinguishable from a
# genuinely quiet day, and never reaching the shared script's freshness guard
# at all. Removed 2026-08-11; see jasproj/_tools#94 and its follow-up fix.
#
# All filtering, classification (SITEMAP_STALE / SITEMAP_UNPARSEABLE /
# NO_CHANGES / SUBMITTED), and the actual IndexNow POST are delegated to
# jasproj/_tools's scripts/indexnow-submit.sh, which this wrapper `exec`s
# into directly so its exit code is never wrapped, trapped, or normalized —
# see _tools/docs/indexnow.md for the outcome table and exit codes.
#
# Usage:
#   source ~/.secrets/api.env
#   INDEXNOW_KEY="$INDEXNOW_KEY_<SLUG>" scripts/indexnow.sh
#
# Override the lastmod window:
#   INDEXNOW_KEY="$INDEXNOW_KEY_<SLUG>" LASTMOD_DAYS=7 scripts/indexnow.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE_HOST="wanderengland.com"
LASTMOD_DAYS="${LASTMOD_DAYS:-30}"

if [ -z "${INDEXNOW_KEY:-}" ]; then
  echo "INDEXNOW_KEY env var not set. Source ~/.secrets/api.env first." >&2
  exit 1
fi

KEY_LOCATION="https://${SITE_HOST}/${INDEXNOW_KEY}.txt"

SHARED_SCRIPT="${TOOLS_DIR:-$HOME/repos/_tools}/scripts/indexnow-submit.sh"
if [ ! -x "$SHARED_SCRIPT" ]; then
  echo "Shared script not found or not executable: $SHARED_SCRIPT" >&2
  echo "Set TOOLS_DIR if _tools lives elsewhere." >&2
  exit 1
fi

SITEMAP="$REPO_ROOT/sitemap.xml"
if [ ! -f "$SITEMAP" ]; then
  echo "No sitemap.xml at $SITEMAP" >&2
  exit 1
fi

# Local, out-of-repo state so re-runs can tell the guard what was already
# submitted (-> NO_CHANGES instead of resubmitting the same URLs every time).
# Missing/empty is fine on a first run: the shared script treats an unset
# prior-run-json as "no history yet".
STATE_DIR="${INDEXNOW_STATE_DIR:-$HOME/.cache/indexnow}"
mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/${SITE_HOST}.run.json"
PRIOR_RUN_JSON=""
[ -f "$STATE_FILE" ] && PRIOR_RUN_JSON="$STATE_FILE"

exec "$SHARED_SCRIPT" "$SITE_HOST" "$INDEXNOW_KEY" "$KEY_LOCATION" "$SITEMAP" "$LASTMOD_DAYS" "$STATE_FILE" "$PRIOR_RUN_JSON"
