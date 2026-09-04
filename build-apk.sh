#!/usr/bin/env bash
set -euo pipefail

MANIFEST_URL="$1"
PACKAGE_ID="${2:-com.example.imox}"
APP_NAME="IMMO X"
SHORT_NAME="IMMO X"
OUTDIR="twa-project"

if [ -z "$MANIFEST_URL" ]; then
  echo "Usage: $0 <manifest_url> [packageId]"
  exit 1
fi

# Install bubblewrap if missing
if ! command -v bubblewrap >/dev/null 2>&1; then
  echo "Installing @bubblewrap/cli globally..."
  npm install -g @bubblewrap/cli
fi

# Init TWA project. Use non-interactive accept (yes) to accept defaults where possible.
# Note: bubblewrap may still prompt on some systems; running in CI should be non-interactive.
if [ -d "$OUTDIR" ]; then
  echo "Removing existing $OUTDIR"
  rm -rf "$OUTDIR"
fi

echo "Initializing TWA project (manifest=$MANIFEST_URL, package=$PACKAGE_ID)..."
# Use yes to auto-accept prompts. If bubblewrap supports --output, it will place files there.
yes '' | bubblewrap init --manifest="$MANIFEST_URL" --packageId="$PACKAGE_ID" --name="$APP_NAME" --shortName="$SHORT_NAME" --output="$OUTDIR" || true

cd "$OUTDIR"

# Build debug APK
if [ -f "gradlew" ]; then
  echo "Running gradle assembleDebug..."
  ./gradlew assembleDebug
else
  echo "gradlew not found — initialization may have failed. Contents of $OUTDIR:" && ls -la
  exit 2
fi

APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK_PATH" ]; then
  echo "Built APK: $(pwd)/$APK_PATH"
else
  echo "APK not found at $APK_PATH — check build output above" >&2
  exit 3
fi
