#!/usr/bin/env bash
#
# deploy-s3.sh — publish the admin-web build to S3 + CloudFront with correct
# per-class Cache-Control headers, then PROVE the result from the public edge.
#
# WHY THIS FILE EXISTS
# --------------------
# admin-web had NO scripts directory at all. Every deploy re-typed the sync by
# hand, which is exactly the condition the deployment tracker's root-cause note
# on the 2026-07-17 cache incident named:
#   "No script owns the S3 sync; every deploy re-types it freehand, so the
#    method silently drifts. This will recur until the sync, with cache headers
#    baked in, lives in a script."
# On mobile-web that drift cost 70 objects their Cache-Control headers, and it
# was nearly missed because the review compared the CODE DIFF (innocent) rather
# than the DEPLOY METHOD. This is the mobile-web script's method, applied to the
# admin distribution — deliberately the SAME convention, not a second one. If
# you improve one, look at the other.
#
# 🛑 A STATUS CODE IS NOT PROOF ON THIS DISTRIBUTION
# --------------------------------------------------
# The admin site is a client-side router, so CloudFront maps origin 403 and 404
# to /index.html AT STATUS 200 (aws/admin/cloudfront-spa-fallback.json). The
# consequence is not optional knowledge:
#
#     ANY MISSING OBJECT RETURNS HTTP 200 WITH Content-Type: text/html.
#
# A missing bundle returns 200. A typo'd path returns 200. A deploy that
# uploaded nothing at all returns 200 on every URL you try. A status-only smoke
# check therefore produces FALSE GREENS here, forever, and looks green while the
# console is broken. Every assertion in the verify pass below checks
# Content-Type as well as status, and --verify-only proves the trap is live by
# requesting an object that is known not to exist.
#
# THE CACHE POLICY (the actual point of this script)
# -------------------------------------------------
#   assets/<name>-<8charhash>.<ext>   immutable, 1 year — Vite content-hashes
#                                     these, so a change is a NEW url. Safe.
#   index.html                        no-cache — the entry point. It names every
#                                     hashed chunk; if it is cached, an operator
#                                     is pinned to an old console and the new
#                                     chunks are unreachable.
#   everything else                   7 days — unhashed, stable filenames
#                                     (favicon.svg today). `immutable` would
#                                     strand an edit for a year; 7 days bounds
#                                     staleness and ETag revalidation keeps the
#                                     repeat cost at a 304.
#
# ZERO OBJECTS ARE IMMUTABLE WITHOUT A CONTENT HASH. That is the rule, and it is
# enforced by classifying on the FILENAME, never on the assets/ prefix — the
# prefix classifier was a real bug on mobile-web, where hand-named files under
# assets/ were pinned for a year and re-pinned on every run.
#
# Usage:
#   ./deploy-s3.sh --dry-run              # show what would change, mutate nothing
#   ./deploy-s3.sh                        # deploy + invalidate + verify
#   ./deploy-s3.sh --prune                # also delete superseded objects (read the note)
#   ./deploy-s3.sh --verify-only          # just audit the live headers
#   ./deploy-s3.sh --repair               # re-upload identical bytes with the policy applied
#   ./deploy-s3.sh --check-spa-fallback   # read-only: live CustomErrorResponses vs the repo
#   ./deploy-s3.sh --apply-spa-fallback   # write: merge the repo's fallback into the live config
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST="${DIST:-$(cd "$HERE/.." && pwd)/dist}"
REPO_ROOT="${REPO_ROOT:-$(cd "$HERE/../../../.." && pwd)}"
FALLBACK_JSON="${FALLBACK_JSON:-$REPO_ROOT/aws/admin/cloudfront-spa-fallback.json}"

BUCKET="${BUCKET:-shramsafal-admin-prod}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:-E31NGXQN85PXV7}"
PUBLIC_URL="${PUBLIC_URL:-https://admin.shramsafal.in}"

IMMUTABLE="public,max-age=31536000,immutable"
SHORT="public,max-age=604800"
REVALIDATE="no-cache"

DRY_RUN=""
PRUNE=0
VERIFY_ONLY=0
REPAIR=0
SPA_CHECK=0
SPA_APPLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)             DRY_RUN="--dryrun" ;;
    --prune)               PRUNE=1 ;;
    --verify-only)         VERIFY_ONLY=1 ;;
    --repair)              REPAIR=1 ;;
    --check-spa-fallback)  SPA_CHECK=1 ;;
    --apply-spa-fallback)  SPA_APPLY=1 ;;
    -h|--help)             sed -n '2,70p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

# aws.exe is a native Windows binary; under MSYS/Git-Bash a POSIX path gets
# mangled and the sync silently reports "0 changes". Convert before handing any
# path to aws.
to_aws_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: '$1' is required and not on PATH." >&2; exit 1; }
}

# ---------------------------------------------------------------------------
# The SPA history fallback. Read-only by default; --apply-spa-fallback writes.
#
# CloudFront has no partial update: you must send the WHOLE DistributionConfig
# back with its ETag. So the repo file is a FRAGMENT that gets merged, and the
# apply path re-reads the live config every time rather than storing one — a
# stale stored config would silently revert whatever else was changed in the
# console since.
# ---------------------------------------------------------------------------
live_spa_fallback() {
  aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID" \
    --query 'DistributionConfig.CustomErrorResponses' --output json
}

wanted_spa_fallback() {
  jq 'del(._comment)' "$FALLBACK_JSON"
}

check_spa_fallback() {
  need aws; need jq
  log "comparing live CustomErrorResponses on $DISTRIBUTION_ID with the repo"
  local live want
  live="$(live_spa_fallback)"
  want="$(wanted_spa_fallback)"
  # Compare as SORTED JSON, not as text: CloudFront returns the items in its own
  # order and with its own key order, and a text diff would fail on formatting
  # while a real difference in ErrorCachingMinTTL slipped past a grep.
  if [ "$(printf '%s' "$live" | jq -S .)" = "$(printf '%s' "$want" | jq -S .)" ]; then
    echo "  OK — the live distribution matches aws/admin/cloudfront-spa-fallback.json"
    return 0
  fi
  echo "  MISMATCH. Live:"; printf '%s\n' "$live" | sed 's/^/    /'
  echo "  Repo:";            printf '%s\n' "$want" | sed 's/^/    /'
  echo
  echo "  Every deep link in this console depends on this. Apply with:" >&2
  echo "    $0 --apply-spa-fallback" >&2
  return 1
}

apply_spa_fallback() {
  need aws; need jq
  log "applying the SPA fallback to $DISTRIBUTION_ID"
  local dc merged etag
  dc="$(mktemp)"; merged="$(mktemp)"
  aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID" > "$dc"
  etag="$(jq -r '.ETag' "$dc")"
  jq --slurpfile f "$FALLBACK_JSON" \
     '.DistributionConfig | .CustomErrorResponses = ($f[0] | del(._comment))' \
     "$dc" > "$merged"
  aws cloudfront update-distribution \
    --id "$DISTRIBUTION_ID" \
    --if-match "$etag" \
    --distribution-config "file://$(to_aws_path "$merged")" \
    --query 'Distribution.Status' --output text
  rm -f "$dc" "$merged"
  echo "  submitted — CloudFront takes a few minutes to reach Deployed."
}

if [ "$SPA_CHECK" -eq 1 ]; then check_spa_fallback; exit $?; fi
if [ "$SPA_APPLY" -eq 1 ]; then apply_spa_fallback; exit 0; fi

# ---------------------------------------------------------------------------
# Classification. Filename, never prefix.
# ---------------------------------------------------------------------------

# Is this filename content-hashed by Vite (e.g. index-C5KCcNz8.js)?
#
# `immutable` is only ever safe for a hashed name, because a change produces a
# NEW url. Unsure => NOT hashed. A wrongly-short cache costs a little bandwidth;
# a wrongly `immutable` one strands the file in browsers for a year with no way
# to reach the people holding it.
is_content_hashed() {
  case "$(basename "$1")" in
    *-????????.*) return 0 ;;   # Vite's 8-char hash suffix
    *)            return 1 ;;
  esac
}

# Which Cache-Control a given dist-relative path must be served with.
# Single source of truth: both the upload passes and the verify pass read this.
policy_for() {
  case "$1" in
    index.html) printf '%s' "$REVALIDATE"; return ;;
  esac
  if is_content_hashed "$1"; then printf '%s' "$IMMUTABLE"; else printf '%s' "$SHORT"; fi
}

# Expected Content-Type per extension. Asserting "not text/html" is NOT enough:
# a .css degrading to application/octet-stream would leave the console unstyled
# while that weaker check passed it.
expected_ctype() {
  case "$1" in
    *.html) printf 'text/html' ;;
    *.js)   printf 'javascript' ;;   # substring: text/ or application/javascript
    *.css)  printf 'text/css' ;;
    *.svg)  printf 'image/svg' ;;
    *.json|*.webmanifest) printf 'json' ;;
    *.png)  printf 'image/png' ;;
    *.woff2) printf 'font/woff2' ;;
    *)      printf '' ;;             # unknown extension: skip the assertion
  esac
}

if [ ! -d "$DIST" ]; then
  echo "ERROR: dist not found at $DIST — run 'npm run build' first." >&2
  exit 1
fi
need aws
need curl

AWS_DIST="$(to_aws_path "$DIST")"

# ---------------------------------------------------------------------------
# Upload passes. One pass per cache class, because a single `aws s3 sync` can
# carry only ONE --cache-control value — which is exactly the trap that stripped
# the headers off mobile-web (one sync, no header, everything lost them).
# ---------------------------------------------------------------------------
sync_class() {
  local desc="$1" cache="$2"; shift 2
  log "$desc  ->  $cache"
  # Deliberately no --metadata-directive. That flag governs S3->S3 copies and is
  # the exact mechanism that can silently clobber Content-Type; on a local->S3
  # upload the metadata is set from the request and sync derives Content-Type
  # from the file extension, which is how the correct types got there at all.
  #
  # Each caller passes its OWN filters, including any leading --exclude "*". Do
  # not hardcode one here: the catch-all pass works by excluding the other
  # classes from a default-include, and a hardcoded --exclude "*" would make it
  # upload nothing while reporting success.
  aws s3 sync "$AWS_DIST" "s3://$BUCKET/" \
    "$@" \
    --cache-control "$cache" \
    $DRY_RUN
}

if [ "$VERIFY_ONLY" -eq 0 ]; then
  # `aws s3 sync` uploads only files whose size differs OR whose local mtime is
  # NEWER than the S3 object. Right for a normal deploy, but it means a
  # policy-only fix on an UNCHANGED build uploads nothing and leaves the wrong
  # headers in place. --repair forces the re-upload by bumping mtimes. Content is
  # untouched, so a repair run is byte-neutral by construction.
  if [ "$REPAIR" -eq 1 ]; then
    log "repair mode — touching dist so the header passes actually re-upload"
    find "$DIST" -type f -exec touch {} +
  fi

  # Only CONTENT-HASHED names get the 1-year pin. `?` matches exactly one
  # character, so *-????????.* selects Vite's 8-char suffix and nothing else.
  sync_class "content-hashed assets (safe to cache forever)" "$IMMUTABLE" \
    --exclude "*" --include "assets/*-????????.*"

  # Everything not hashed and not the shell. Expressed as EXCLUSIONS so a new
  # unhashed file added later lands here automatically rather than being missed
  # — an include-list silently skips whatever nobody remembered to add.
  sync_class "unhashed static (stable filenames — bounded staleness)" "$SHORT" \
    --exclude "assets/*-????????.*" --exclude "index.html"

  sync_class "app shell (must always revalidate)" "$REVALIDATE" \
    --exclude "*" --include "index.html"

  # PRUNE IS OPT-IN HERE, AND THAT DIFFERS FROM MOBILE-WEB ON PURPOSE.
  #
  # mobile-web prunes by default because its bucket's other tenants are KNOWN
  # and excluded by name (apk/, deploy/). Nobody has enumerated what else lives
  # in shramsafal-admin-prod, and `--delete` against an unenumerated bucket is
  # not a reversible operation. So the default is to leave superseded objects
  # behind — they are content-hashed, unreachable and cheap — and pruning is a
  # decision someone makes after looking.
  if [ "$PRUNE" -eq 1 ]; then
    log "pruning superseded objects — LIST THE BUCKET FIRST IF YOU HAVE NOT"
    aws s3 ls "s3://$BUCKET/" | sed 's/^/    /'
    # --size-only avoids re-uploading identical content: a re-upload in this
    # pass would carry no --cache-control and reintroduce the very bug the
    # header passes above exist to prevent.
    aws s3 sync "$AWS_DIST" "s3://$BUCKET/" \
      --delete --size-only \
      $DRY_RUN
  fi

  if [ -n "$DRY_RUN" ]; then
    log "DRY RUN — nothing was changed. Re-run without --dry-run to deploy."
    exit 0
  fi

  log "invalidating CloudFront $DISTRIBUTION_ID"
  # Uses --invalidation-batch file:// rather than --paths '/*'. Under MSYS on
  # Windows a bare '/*' gets path-mangled into something like C:/Program Files/*
  # and the invalidation silently covers the wrong paths. The batch file
  # sidesteps argument conversion entirely.
  _batch="$(mktemp)"
  cat > "$_batch" <<JSON
{"Paths":{"Quantity":1,"Items":["/*"]},"CallerReference":"admin-deploy-$(date -u +%Y%m%dT%H%M%SZ)"}
JSON
  INVALIDATION_ID="$(aws cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION_ID" \
    --invalidation-batch "file://$(to_aws_path "$_batch")" \
    --query 'Invalidation.Id' --output text)"
  rm -f "$_batch"
  echo "    invalidation: $INVALIDATION_ID"

  # Verifying before the invalidation completes reads the OLD headers from the
  # edge and reports a false failure — or worse, a false pass.
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
# VERIFY from the public edge. curl against the real URL, not S3 metadata: this
# has to prove what an OPERATOR actually receives, through the CDN.
# ---------------------------------------------------------------------------
head_of() { curl -sI "$1" || true; }
field()   { printf '%s' "$2" | grep -i "^$1:" | sed "s/^[^:]*: *//" | tr -d '\r'; }
status_of() { printf '%s' "$1" | head -1 | awk '{print $2}'; }

log "verifying live headers at $PUBLIC_URL"
fail=0; checked=0
while IFS= read -r file; do
  rel="${file#"$DIST"/}"
  want="$(policy_for "$rel")"

  # Keys can contain spaces; an unencoded URL returns HTTP 000 and reads as a
  # false failure rather than as a bad request.
  url_path="$(printf '%s' "$rel" | sed 's/ /%20/g')"
  headers="$(head_of "$PUBLIC_URL/$url_path")"

  got="$(field 'cache-control' "$headers")"
  code="$(status_of "$headers")"
  ctype="$(field 'content-type' "$headers" | cut -d';' -f1)"

  checked=$((checked + 1))

  if [ "$code" != "200" ]; then
    echo "  FAIL  $rel — HTTP $code"; fail=$((fail + 1)); continue
  fi

  # 🛑 THE CONTENT-TYPE ASSERTION IS NOT OPTIONAL AND IS NOT BELT-AND-BRACES.
  # On this distribution a MISSING object returns HTTP 200 + text/html, because
  # of the SPA fallback. So the status check above proves nothing about
  # existence; this is the check that does. It runs BEFORE the Cache-Control
  # comparison so a missing file reports as missing rather than as a header bug,
  # which is a far more misleading thing to be told.
  want_ctype="$(expected_ctype "$rel")"
  if [ -n "$want_ctype" ] && ! printf '%s' "$ctype" | grep -qi "$want_ctype"; then
    if [ "$ctype" = "text/html" ] && [ "$want_ctype" != "text/html" ]; then
      echo "  FAIL  $rel — DOES NOT EXIST (200 text/html is the SPA fallback, not this file)"
    else
      echo "  FAIL  $rel — Content-Type '${ctype:-<none>}' (expected to contain '$want_ctype')"
    fi
    fail=$((fail + 1)); continue
  fi

  if [ "$got" != "$want" ]; then
    echo "  FAIL  $rel — Cache-Control '${got:-<missing>}' (expected '$want')"
    fail=$((fail + 1)); continue
  fi
done < <(find "$DIST" -type f | sort)

# ---------------------------------------------------------------------------
# Two checks about the FALLBACK ITSELF, which no per-file loop can make.
# ---------------------------------------------------------------------------
log "verifying the SPA history fallback"

# 1. A deep link must serve the app. This is the whole reason the fallback
#    exists: /farms?tier=B&page=3 is not an object in S3, and a shared URL,
#    a bookmark or a hard refresh on any screen depends on this answering.
deep="$PUBLIC_URL/farms?tier=B&page=3"
h="$(head_of "$deep")"
if [ "$(status_of "$h")" = "200" ] && printf '%s' "$(field 'content-type' "$h")" | grep -qi 'text/html'; then
  echo "  OK    deep link /farms?tier=B&page=3 -> 200 text/html"
else
  echo "  FAIL  deep link /farms?tier=B&page=3 -> HTTP $(status_of "$h") $(field 'content-type' "$h")"
  echo "        Every shareable URL in this console is dead. Run --check-spa-fallback."
  fail=$((fail + 1))
fi
checked=$((checked + 1))

# 2. The trap, demonstrated rather than described. A path that is known not to
#    exist must come back 200 text/html — and if it does NOT, the fallback is
#    off and check 1 above was passing for the wrong reason. Either way this
#    line is what makes the Content-Type assertions above legible to whoever
#    reads this output next: on this distribution, status 200 means nothing.
ghost="$PUBLIC_URL/assets/deliberately-missing-00000000.js"
h="$(head_of "$ghost")"
gcode="$(status_of "$h")"; gtype="$(field 'content-type' "$h" | cut -d';' -f1)"
if [ "$gcode" = "200" ] && [ "$gtype" = "text/html" ]; then
  echo "  OK    a known-missing asset returns 200 $gtype — the fallback is ON,"
  echo "        which is why STATUS ALONE IS NEVER PROOF on this distribution."
else
  echo "  WARN  a known-missing asset returned HTTP $gcode ${gtype:-<none>}, not 200 text/html."
  echo "        The fallback may be off or scoped differently than this repo records."
  echo "        Run --check-spa-fallback. Not counted as a failure: a real 404 here"
  echo "        is safer than a false green, it just is not what we deployed."
fi

echo
if [ "$fail" -gt 0 ]; then
  echo "VERIFY FAILED: $fail of $checked checks wrong." >&2
  echo "Fix headers:  $0 --repair   (re-uploads the same bytes with the policy applied)" >&2
  echo "Fix routing:  $0 --check-spa-fallback" >&2
  exit 1
fi
echo "VERIFY OK: $checked/$checked checks pass — Cache-Control, Content-Type and the deep-link fallback."
