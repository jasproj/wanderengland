#!/usr/bin/env bash
# scripts/indexnow.sh — submit recently-changed URLs from this repo's sitemap to IndexNow.
#
# Reads the local sitemap.xml, filters to URLs whose <lastmod> is within the last
# $LASTMOD_DAYS days (default 30), then calls the shared submission script in
# jasproj/_tools (assumed at $TOOLS_DIR or ~/repos/_tools).
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

CUTOFF=$(date -v-"${LASTMOD_DAYS}"d +%Y-%m-%d 2>/dev/null || date -d "${LASTMOD_DAYS} days ago" +%Y-%m-%d)
URL_FILE=$(mktemp)
trap 'rm -f "$URL_FILE"' EXIT

python3 - "$SITEMAP" "$CUTOFF" > "$URL_FILE" <<'PYEOF'
import sys, re
sitemap, cutoff = sys.argv[1], sys.argv[2]
with open(sitemap) as f:
    data = f.read()
pattern = re.compile(r'<url>\s*<loc>([^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>', re.DOTALL)
for url, lastmod in pattern.findall(data):
    if lastmod >= cutoff:
        print(url)
PYEOF

URL_COUNT=$(wc -l < "$URL_FILE" | tr -d ' ')
echo "Filtered to $URL_COUNT URLs (lastmod >= $CUTOFF)" >&2

if [ "$URL_COUNT" -eq 0 ]; then
  echo "No recently-changed URLs to submit. Exiting cleanly." >&2
  exit 0
fi

"$SHARED_SCRIPT" "$SITE_HOST" "$INDEXNOW_KEY" "$KEY_LOCATION" "$URL_FILE"
