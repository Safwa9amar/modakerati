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

# --environment is REQUIRED from SDK 55 on, and mandatory outright when stdin is
# not a TTY (a CI job, an agent shell) — without it the command just refuses.
#
# It selects which SERVER-SIDE EAS environment variables to pull, which is a
# different mechanism from the .env file swapped in above, and one this project
# does not use: the values that reach the bundle are the EXPO_PUBLIC_* lines
# printed a few lines up. It matters anyway, because anything defined in that
# EAS environment is written into the process env BEFORE the bundler runs, and
# .env never overwrites an already-set variable — so a server-side
# EXPO_PUBLIC_API_URL would silently outrank .env.production. Check the
# "Environment variables loaded from the ... environment" line the CLI prints
# before it bundles; it should be empty for this project.
ENVIRONMENT="${3:-production}"
echo "▸ EAS environment: $ENVIRONMENT (server-side vars only — the bundle's values are the ones above)"

# ONE PLATFORM AT A TIME, deliberately. `eas update` takes all|android|ios and
# nothing else — there is no comma list — and "all" means every platform the app
# config allows, which with no `platforms` key in app.json includes WEB. The web
# export dies on expo-sqlite: its web build imports ./wa-sqlite/wa-sqlite.wasm,
# that file is not in the published package, and Metro fails the whole export
# over it. Nothing ships to a browser here, so there is no reason to bundle one.
#
# The obvious fix — pinning `platforms` in app.json — is the WRONG one: app.json
# is a fingerprint input, so it would move the runtime version and cut every
# installed binary off from this and every future update. Keep it out here.
#
# So: two invocations, which land as two update groups on the same channel. A
# binary is only ever offered the one matching its own platform, so this is the
# same thing "all" would do, minus the web export that cannot build.
for PLATFORM in android ios; do
  echo "▸ publishing $PLATFORM…"
  $EAS update --channel "$CHANNEL" --message "$MESSAGE" \
    --platform "$PLATFORM" --environment "$ENVIRONMENT" --non-interactive
done
