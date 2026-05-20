#!/usr/bin/env sh
set -eu

# Builds `dbm-server` and lays it under `src-tauri/binaries/dbm-server-<triple>`
# so Tauri's externalBin picks it up at bundle time (or for dev, so
# `start_local_server` can spawn the sidecar via the resolver fallback).

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo not found in PATH" >&2
  exit 1
fi

PROFILE="${CARGO_PROFILE:-release}"
PROFILE_DIR="$PROFILE"
[ "$PROFILE" = "dev" ] && PROFILE_DIR="debug"

EXT=""
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) EXT=".exe" ;;
esac

TRIPLE="$(rustc -vV | sed -n 's|host: ||p')"
TARGET_BIN="dbm-server-${TRIPLE}${EXT}"

echo "building dbm-server ($PROFILE) for $TRIPLE"
if [ "$PROFILE" = "release" ]; then
  cargo build --release -p dbm-server
else
  cargo build -p dbm-server
fi

mkdir -p src-tauri/binaries
src="target/${PROFILE_DIR}/dbm-server${EXT}"
dst="src-tauri/binaries/${TARGET_BIN}"
cp "$src" "$dst"
echo "  -> $dst"
