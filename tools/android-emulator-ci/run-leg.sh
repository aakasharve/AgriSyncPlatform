#!/usr/bin/env bash
# CI-ONLY. Runs INSIDE android-emulator-runner (an emulator is already booted). Installs the internal-test
# apk, applies the screen profile, runs the driver, and always leaves the evidence in $OUT_DIR.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${APK:?}" "${OUT_DIR:?}" "${CI_WORK:?}" "${APP_ID:?}"
mkdir -p "$OUT_DIR"

# The driver reads these (secrets stay inside this job).
set -a; . "$CI_WORK/ci.env"; set +a
echo "::add-mask::$DEMO_PASSWORD"

adb wait-for-device
for i in $(seq 1 60); do [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ] && break; sleep 3; done
adb shell input keyevent 82 || true               # dismiss keyguard
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
adb shell settings put system font_scale 1.0
adb shell settings put system accelerometer_rotation 0

if [ "${SCREEN:-normal}" = "small" ]; then
  adb shell wm size 720x1280
  adb shell wm density 320          # 360 x 640 dp: the classic small Android phone
fi
adb shell wm size; adb shell wm density
adb shell getprop ro.build.version.sdk

adb uninstall "$APP_ID" >/dev/null 2>&1 || true
adb install -r -t "$APK"
adb shell pm list packages | grep "$APP_ID"

cd "$HERE"
node driver.mjs 2>&1 | tee "$OUT_DIR/driver.log"
rc=${PIPESTATUS[0]}
echo "driver exit code: $rc"
echo "$rc" > "$OUT_DIR/driver.exit"
adb exec-out screencap -p > "$OUT_DIR/final-screen.png" 2>/dev/null || true
adb logcat -d -t 20000 > "$OUT_DIR/logcat-full-tail.txt" 2>/dev/null || true
exit 0
