#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

MODE="${1:-release}"

if [[ "$MODE" == "-h" || "$MODE" == "--help" ]]; then
  cat <<EOF
Usage: ./run.sh [release|debug|watch]
  release  cargo run --release (default)
  debug    cargo run
  watch    cargo watch -x 'run' (requires cargo-watch)
EOF
  exit 0
fi

if [[ ! -f .env && ! -f .env.local ]]; then
  echo "Warning: no .env or .env.local found. Copy .env.example first." >&2
fi

case "$MODE" in
  release)
    exec cargo run --release
    ;;
  debug)
    exec cargo run
    ;;
  watch)
    if ! command -v cargo-watch >/dev/null 2>&1; then
      echo "cargo-watch not installed. Install with: cargo install cargo-watch" >&2
      exit 1
    fi
    exec cargo watch -x 'run'
    ;;
  *)
    echo "Unknown mode: $MODE (use release|debug|watch)" >&2
    exit 1
    ;;
esac
