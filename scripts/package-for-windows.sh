#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Native Node.js modules are compiled for the host OS. Run this script on
# Windows to produce a correct package; cross-compiling from macOS/Linux
# will embed binaries that won't work on Windows.
if [[ "${OS:-}" != "Windows_NT" ]]; then
  echo "WARNING: Not running on Windows. Any native Node.js modules will target" >&2
  echo "         $(uname -s), not Windows. Run on Windows for a correct build." >&2
fi

if ! command -v zip >/dev/null 2>&1; then
  echo "ERROR: zip is required to create the package. Install zip and retry." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "ERROR: pnpm is required to build the workspace. Install pnpm and retry." >&2
  exit 1
fi

echo "Installing workspace dependencies..."
pnpm install --frozen-lockfile

echo "Building lhremote workspace..."
pnpm build

STAGING_DIR="tmp/lhremote-windows-package"
rm -rf "$STAGING_DIR"

echo "Deploying production-only package to staging directory..."
pnpm --filter ./packages/lhremote deploy --prod "$STAGING_DIR"

mkdir -p tmp
OUTPUT_FILE="tmp/lhremote-windows-$(date +%Y%m%d%H%M%S).zip"

echo "Creating package: $OUTPUT_FILE"
cd "$STAGING_DIR"
zip -r "$ROOT_DIR/$OUTPUT_FILE" .

cd "$ROOT_DIR"
rm -rf "$STAGING_DIR"

echo "Package created successfully: $OUTPUT_FILE"
