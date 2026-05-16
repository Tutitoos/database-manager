#!/usr/bin/env sh
set -eu

# Build all Rust plugin binaries and copy them next to their manifest.json
# so the Tauri loader picks them up.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo not found in PATH" >&2
  exit 1
fi

EXT=""
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) EXT=".exe" ;;
esac

PROFILE="${CARGO_PROFILE:-release}"
PROFILE_DIR="$PROFILE"
[ "$PROFILE" = "dev" ] && PROFILE_DIR="debug"

PLUGINS="postgresql mongodb redis"
for name in $PLUGINS; do
  bin="${name}-plugin${EXT}"
  echo "building plugin: $name ($bin)"
  if [ "$PROFILE" = "release" ]; then
    cargo build --release -p "dbm-${name}-plugin"
  else
    cargo build -p "dbm-${name}-plugin"
  fi
  src="target/${PROFILE_DIR}/${bin}"
  dst="plugins/${name}/${bin}"
  if [ ! -f "$src" ]; then
    echo "expected binary not found: $src" >&2
    exit 1
  fi
  cp "$src" "$dst"
  echo "  -> $dst"
done
