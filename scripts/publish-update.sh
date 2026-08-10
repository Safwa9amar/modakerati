#!/usr/bin/env bash
# Publish an over-the-air JS/asset update to apps already installed on phones.
#
#   ./scripts/publish-update.sh "fix the export crash"        # → production
#   ./scripts/publish-update.sh "try the new dock" preview    # → preview
#
# Same .env shuffle as build-apk.sh, for a worse reason: EXPO_PUBLIC_* values are
# INLINED into the JS bundle, and this bundle goes straight to phones in people's
# hands. Publishing with your working .env would point every installed app at the
# LAN box on your desk until someone noticed and you rolled back.
#
# OTA carries JS and assets ONLY. Anything native — a new dependency, a config
# plugin, a native app.json field, even eas.json — moves the fingerprint runtime
# version, and this update then won't be offered to the old binary at all. That
# is the safety net doing its job, not a failure: ship a new APK instead.
set -euo pipefail
cd "$(dirname "$0")/.."

MESSAGE="${1:-}"
CHANNEL="${2:-production}"
[ -n "$MESSAGE" ] || { echo "✗ usage: ./scripts/publish-update.sh \"what changed\" [channel]"; exit 1; }

[ -f .env.production ] || { echo "✗ .env.production is missing"; exit 1; }
if grep -q PROJECT_ID_PLACEHOLDER app.json; then
  echo "✗ app.json still has PROJECT_ID_PLACEHOLDER — run 'eas init' and 'eas update:configure' first"
  exit 1
fi

if command -v eas >/dev/null 2>&1; then EAS="eas"; else EAS="npx --yes eas-cli"; fi

RESTORE=0
if [ -f .env ]; then cp .env .env.devbackup; RESTORE=1; fi
restore() {
  if [ "$RESTORE" = "1" ]; then mv -f .env.devbackup .env; echo "▸ restored your dev .env"; else rm -f .env; fi
}
trap restore EXIT

cp .env.production .env
echo "▸ publishing to channel '$CHANNEL' with production env:"
grep -E "^EXPO_PUBLIC" .env | sed 's/^/    /'

# Only binaries built at this exact runtime version will be offered the update.
RTV="$(npx expo-updates runtimeversion:resolve --platform android | node -e \
  'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).runtimeVersion))')"
echo "▸ runtime version: $RTV"
echo "  (installed builds on a different runtime version will NOT see this update)"

$EAS update --channel "$CHANNEL" --message "$MESSAGE"
