#!/usr/bin/env bash
# Build a production-signed release APK with the production API/Supabase values
# baked in.
#
#   ./scripts/build-apk.sh            # release APK
#   ./scripts/build-apk.sh bundle     # .aab for Google Play instead
#
# Why the .env shuffle: EXPO_PUBLIC_* values are INLINED into the JS bundle by
# Metro at build time, and Expo loads plain `.env` (it explicitly recommends
# against relying on NODE_ENV to pick .env.production). Your working `.env`
# points at the LAN dev server, so building without swapping it produces an APK
# that talks to a machine on your desk. This swaps .env.production in for the
# duration of the build and always restores your .env, including on failure.
set -euo pipefail
cd "$(dirname "$0")/.."

TASK="assembleRelease"; OUT="android/app/build/outputs/apk/release/app-release.apk"
if [ "${1:-}" = "bundle" ]; then
  TASK="bundleRelease"; OUT="android/app/build/outputs/bundle/release/app-release.aab"
fi

[ -f .env.production ] || { echo "✗ .env.production is missing"; exit 1; }
grep -q "MODAKERATI_UPLOAD_STORE_FILE" ~/.gradle/gradle.properties 2>/dev/null \
  || { echo "✗ signing credentials not in ~/.gradle/gradle.properties — the build would be DEBUG-signed"; exit 1; }

RESTORE=0
if [ -f .env ]; then cp .env .env.devbackup; RESTORE=1; fi
restore() {
  if [ "$RESTORE" = "1" ]; then mv -f .env.devbackup .env; echo "▸ restored your dev .env"; else rm -f .env; fi
}
trap restore EXIT

cp .env.production .env
echo "▸ building $TASK with production env:"
grep -E "^EXPO_PUBLIC" .env | sed 's/^/    /'

(cd android && ./gradlew "$TASK" --no-daemon)

echo "▸ output: $OUT"
ls -lh "$OUT"
