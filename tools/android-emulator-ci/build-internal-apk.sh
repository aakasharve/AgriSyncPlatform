#!/usr/bin/env bash
# CI-ONLY. Builds the INTERNAL TEST apk: debug-signed, applicationId com.agrisync.shramsafal.internaltest,
# versionName "<release>-internal-test", API origin http://10.0.2.2:<port>. It is built from a THROWAWAY COPY
# of the tracked files (git archive) in $RUNNER_TEMP; nothing tracked in the checkout is ever edited.
# There is no signing key anywhere in this path (Gradle's auto-generated debug keystore only).
#
# Usage: build-internal-apk.sh copy       -> create + patch the throwaway tree (exports INTERNAL_TREE via GITHUB_ENV)
#        build-internal-apk.sh gradle     -> cap sync output already in place -> assembleDebug + verify
set -euo pipefail
cmd="${1:?copy|gradle}"
HARNESS_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# The application under test is a separate checkout pinned to a full SHA (APP_SRC); the harness comes from its own branch.
REPO="${APP_SRC:-$HARNESS_REPO}"

case "$cmd" in
copy)
  : "${API_PORT:?}" "${RUNNER_TEMP:?}"
  TREE="$RUNNER_TEMP/internal-test-tree"
  rm -rf "$TREE"; mkdir -p "$TREE"
  ( cd "$REPO" && git archive HEAD ) | tar -x -C "$TREE"
  echo "INTERNAL_TREE=$TREE" >> "$GITHUB_ENV"
  MW="$TREE/src/clients/mobile-web"
  python3 - "$MW" <<'PY'
import re, sys, pathlib
mw = pathlib.Path(sys.argv[1])

def sub(path, pattern, repl, count=1):
    p = mw / path
    s = p.read_text(encoding='utf-8')
    n, k = re.subn(pattern, repl, s, count=count, flags=re.M)
    if k != count:
        raise SystemExit(f"patch of {path} failed: pattern {pattern!r} matched {k} times (expected {count})")
    p.write_text(n, encoding='utf-8')

# 1. WebView must be inspectable and allow http://10.0.2.2 from the https://localhost page.
sub('capacitor.config.ts', r"webContentsDebuggingEnabled: false,", "webContentsDebuggingEnabled: true,\n    allowMixedContent: true,")
# 2. A different application id so it can never replace or be confused with the real app.
sub('android/app/build.gradle', r'applicationId "com\.agrisync\.shramsafal"', 'applicationId "com.agrisync.shramsafal.internaltest"')
sub('android/app/build.gradle', r'versionName "([^"]+)"', lambda m: f'versionName "{m.group(1)}-internal-test"')
# 3. A visibly different launcher label.
sub('android/app/src/main/res/values/strings.xml', r'<string name="app_name">ShramSafal</string>', '<string name="app_name">ShramSafal INTERNAL TEST</string>')
print("patched throwaway copy only")
PY
  # The tracked checkout must be untouched.
  ( cd "$REPO" && test -z "$(git status --porcelain --untracked-files=no)" ) || { echo "::error::tracked files in the checkout changed"; exit 1; }
  ;;
gradle)
  : "${INTERNAL_TREE:?}" "${OUT:?}"
  MW="$INTERNAL_TREE/src/clients/mobile-web"
  mkdir -p "$OUT"
  cd "$MW/android"
  chmod +x gradlew
  ./gradlew assembleDebug --no-daemon --console=plain
  APK="$(ls app/build/outputs/apk/debug/*.apk | head -1)"
  cp "$APK" "$OUT/app-internal-test-debug.apk"
  BT="$(ls -d "$ANDROID_SDK_ROOT"/build-tools/* | sort -V | tail -1)"
  "$BT/aapt2" dump badging "$APK" | grep -E "^(package:|application-debuggable|sdkVersion|targetSdkVersion|application-label:)" | tee "$OUT/apk-badging.txt"
  "$BT/apksigner" verify --print-certs "$APK" | tee "$OUT/apk-signer.txt"
  grep -q "package: name='com.agrisync.shramsafal.internaltest'" "$OUT/apk-badging.txt" || { echo "::error::wrong applicationId"; exit 1; }
  grep -q "versionName='[^']*-internal-test'" "$OUT/apk-badging.txt" || { echo "::error::versionName lacks -internal-test"; exit 1; }
  grep -qi "Android Debug" "$OUT/apk-signer.txt" || { echo "::error::apk is not debug-signed"; exit 1; }
  # What the bundle talks to (informational: counts only, no content).
  {
    echo "bundle references to the test API origin:   $(grep -rF "http://10.0.2.2:${API_PORT}" "$MW/dist" | wc -l)"
    echo "bundle references to https://api.shramsafal.in: $(grep -rF 'https://api.shramsafal.in' "$MW/dist" | wc -l)"
  } | tee "$OUT/bundle-origins.txt"
  grep -rqF "http://10.0.2.2:${API_PORT}" "$MW/dist" || { echo "::error::test API origin missing from the bundle"; exit 1; }
  ;;
*) echo "unknown command $cmd"; exit 64;;
esac
