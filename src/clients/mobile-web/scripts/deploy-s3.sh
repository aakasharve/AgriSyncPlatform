#!/usr/bin/env bash
#
# deploy-s3.sh — publish the mobile-web build to S3 + CloudFront with correct
# per-class Cache-Control headers, then PROVE the result from the public edge.
#
# WHY THIS FILE EXISTS
# --------------------
# The S3 sync used to be re-typed by hand on every deploy, so the method drifted:
#   2026-07-14 (93d4f19e) — deliberate multi-pass sync, headers set correctly.
#   2026-07-17 (d4a91c7e) — plain one-line `aws s3 sync`, NO --cache-control.
#                           `sync` writes no Cache-Control on the files it uploads,
#                           so all 70 uploaded objects silently lost their headers.
#   2026-07-18 (7c2e5a94) — restored by hand. Again.
# The regression was nearly missed because a review compared the CODE DIFF (one
# .tsx file, innocent) rather than the DEPLOY METHOD. Codifying the method here is
# what stops the drift; the verify step at the end is what stops it being missed.
#
# THE CACHE POLICY (the actual point of this script)
# -------------------------------------------------
#   assets/**            immutable, 1 year   — Vite content-hashes these filenames,
#                                              so a changed file is a NEW url. Safe.
#   index.html, sw.js    no-cache            — the entry points. Must revalidate or
#                                              users are pinned to an old app build.
#   consent/**           no-cache            — LEGAL TEXT (DPDP consent agreement),
#                                              fetched by FIXED path from
#                                              ConsentAgreement.tsx. If this is ever
#                                              corrected, cached users must not keep
#                                              seeing the old agreement. Correctness
#                                              beats bytes; these are small .md files
#                                              and revalidation returns a cheap 304.
#   everything else      7 days              — unhashed static (brand/, images/,
#                                              logo, manifest, worklet). Filenames are
#                                              STABLE, so `immutable` would strand an
#                                              edit for a year. 7 days bounds staleness
#                                              while ETag revalidation keeps repeat
#                                              downloads near zero for farmers on
#                                              metered 2G/3G.
#
# NEVER TOUCHES apk/* or deploy/* — those live in the same bucket but are not part
# of this build, and a careless `--delete` would wipe the published APK.
#
# Usage:
#   ./deploy-s3.sh --dry-run                 # show what would change, mutate nothing
#   ./deploy-s3.sh                           # deploy + invalidate + verify
#   ./deploy-s3.sh --no-prune                # skip deleting superseded objects
#   ./deploy-s3.sh --verify-only             # just audit the live headers
#
set -euo pipefail

DIST="${DIST:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/dist}"
BUCKET="${BUCKET:-shramsafal-app-prod}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:-EFLL3RCLOOO60}"
PUBLIC_URL="${PUBLIC_URL:-https://app.shramsafal.in}"

IMMUTABLE="public,max-age=31536000,immutable"
SHORT="public,max-age=604800"
REVALIDATE="no-cache"

DRY_RUN=""
PRUNE=1
VERIFY_ONLY=0
REPAIR=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)     DRY_RUN="--dryrun" ;;
    --no-prune)    PRUNE=0 ;;
    --verify-only) VERIFY_ONLY=1 ;;
    --repair)      REPAIR=1 ;;
    -h|--help)     sed -n '2,60p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

# aws.exe is a native Windows binary; under MSYS/Git-Bash a POSIX path gets mangled
# and the sync silently reports "0 changes". Convert before handing any path to aws.
to_aws_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# Which Cache-Control a given dist-relative path must be served with.
# Single source of truth: both the upload passes and the verify pass read this.
policy_for() {
  case "$1" in
    assets/*)            printf '%s' "$IMMUTABLE" ;;
    index.html|sw.js)    printf '%s' "$REVALIDATE" ;;
    consent/*)           printf '%s' "$REVALIDATE" ;;
    *)                   printf '%s' "$SHORT" ;;
  esac
}

if [ ! -d "$DIST" ]; then
  echo "ERROR: dist not found at $DIST — run 'npm run build:prod' first." >&2
  exit 1
fi

AWS_DIST="$(to_aws_path "$DIST")"

# ---------------------------------------------------------------------------
# Upload passes. One pass per cache class, because a single `aws s3 sync` can
# only carry ONE --cache-control value — which is exactly the trap that produced
# the d4a91c7e regression (one sync, no header, everything stripped).
# ---------------------------------------------------------------------------
sync_class() {
  local desc="$1" cache="$2"; shift 2
  log "$desc  ->  $cache"
  # NOTE: deliberately no --metadata-directive. That flag governs S3->S3 copies and
  # is the exact mechanism that can silently clobber Content-Type; on a local->S3
  # upload the metadata is set from the request, and sync derives Content-Type from
  # the file extension (which is how the correct types got there originally).
  aws s3 sync "$AWS_DIST" "s3://$BUCKET/" \
    --exclude "*" "$@" \
    --cache-control "$cache" \
    $DRY_RUN
}

if [ "$VERIFY_ONLY" -eq 0 ]; then
  # `aws s3 sync` uploads only files whose size differs OR whose local mtime is NEWER
  # than the S3 object. That is right for a normal deploy (new build => new bytes), but
  # it means a policy-only fix on an UNCHANGED build would silently upload nothing and
  # leave the wrong headers in place. --repair forces the re-upload by bumping mtimes.
  # Content is untouched, so a repair run is byte-neutral by construction.
  if [ "$REPAIR" -eq 1 ]; then
    log "repair mode — touching dist so the header passes actually re-upload"
    find "$DIST" -type f -exec touch {} +
  fi

  sync_class "hashed assets (safe to cache forever)" "$IMMUTABLE" \
    --include "assets/*"

  sync_class "unhashed static (stable filenames — bounded staleness)" "$SHORT" \
    --include "brand/*" --include "images/*" --include "demo-photos/*" \
    --include "logo.png" --include "manifest.webmanifest" \
    --include "streaming-pcm-processor.worklet.js"

  sync_class "consent legal text (must always revalidate)" "$REVALIDATE" \
    --include "consent/*"

  sync_class "app shell (must always revalidate)" "$REVALIDATE" \
    --include "index.html" --include "sw.js"

  if [ "$PRUNE" -eq 1 ]; then
    # Delete superseded objects. Runs LAST so the header passes above have already
    # written every current file. --size-only avoids re-uploading identical content
    # (a re-upload here would carry no --cache-control and reintroduce the bug).
    # The apk/ and deploy/ excludes are load-bearing: apk/ holds the published APK.
    log "pruning superseded objects (apk/ and deploy/ excluded)"
    aws s3 sync "$AWS_DIST" "s3://$BUCKET/" \
      --delete --size-only \
      --exclude "apk/*" --exclude "deploy/*" \
      $DRY_RUN
  fi

  if [ -n "$DRY_RUN" ]; then
    log "DRY RUN — nothing was changed. Re-run without --dry-run to deploy."
    exit 0
  fi

  log "invalidating CloudFront $DISTRIBUTION_ID"
  INVALIDATION_ID="$(aws cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION_ID" --paths '/*' \
    --query 'Invalidation.Id' --output text)"
  echo "    invalidation: $INVALIDATION_ID"

  # Verifying before the invalidation completes would read the OLD headers from the
  # edge and report a false failure (or worse, a false pass).
  printf '    waiting for it to complete'
  for _ in $(seq 1 60); do
    status="$(aws cloudfront get-invalidation \
      --distribution-id "$DISTRIBUTION_ID" --id "$INVALIDATION_ID" \
      --query 'Invalidation.Status' --output text)"
    [ "$status" = "Completed" ] && break
    printf '.'; sleep 5
  done
  echo " $status"
fi

# ---------------------------------------------------------------------------
# VERIFY from the public edge — the step whose absence let the d4a91c7e
# regression ship unnoticed. Deliberately uses curl against the real URL rather
# than reading S3 metadata: it proves what a FARMER actually receives.
# ---------------------------------------------------------------------------
log "verifying live headers at $PUBLIC_URL"
fail=0; checked=0
while IFS= read -r file; do
  rel="${file#"$DIST"/}"
  want="$(policy_for "$rel")"

  # Keys can contain spaces (e.g. images/crops/Black Grapes.jpg); an unencoded URL
  # returns HTTP 000 and reads as a false failure.
  url_path="$(printf '%s' "$rel" | sed 's/ /%20/g')"
  headers="$(curl -sI "$PUBLIC_URL/$url_path" || true)"

  got="$(printf '%s' "$headers" | grep -i '^cache-control:' | sed 's/^[Cc]ache-[Cc]ontrol: *//' | tr -d '\r')"
  code="$(printf '%s' "$headers" | head -1 | awk '{print $2}')"
  ctype="$(printf '%s' "$headers" | grep -i '^content-type:' | sed 's/^[Cc]ontent-[Tt]ype: *//' | tr -d '\r' | cut -d';' -f1)"

  checked=$((checked + 1))

  if [ "$code" != "200" ]; then
    echo "  FAIL  $rel — HTTP $code"; fail=$((fail + 1)); continue
  fi
  if [ "$got" != "$want" ]; then
    echo "  FAIL  $rel — Cache-Control '${got:-<missing>}' (expected '$want')"
    fail=$((fail + 1)); continue
  fi
  # A missing object returns the SPA fallback: HTTP 200 + text/html. Status alone is
  # therefore not proof of existence — assert the type too, or 404s read as green.
  case "$rel" in
    *.html) ;;
    *) if [ "$ctype" = "text/html" ]; then
         echo "  FAIL  $rel — served as text/html (missing object hitting SPA fallback?)"
         fail=$((fail + 1))
       fi ;;
  esac
done < <(find "$DIST" -type f | sort)

echo
if [ "$fail" -gt 0 ]; then
  echo "VERIFY FAILED: $fail of $checked objects wrong." >&2
  echo "Fix: ./deploy-s3.sh --repair   (re-uploads the same bytes with the policy applied)" >&2
  exit 1
fi
echo "VERIFY OK: $checked/$checked objects serve the correct Cache-Control and Content-Type."
