#!/usr/bin/env bash
# A/B benchmark: Rust pg plugin vs Go pg plugin against same PG.
#
# Usage:
#   PG_HOST=100.124.121.35 PG_PORT=54002 PG_USER=youruser PG_PASS=yourpass \
#   PG_DB=kena PG_TABLE=tracks \
#   sh scripts/bench-pg-plugin.sh
#
# Optional: PG_WHERE="id > 100 AND active = true" PG_LIMIT=100
set -eu

HOST="${PG_HOST:?set PG_HOST}"
PORT="${PG_PORT:?set PG_PORT}"
USER="${PG_USER:?set PG_USER}"
PASS="${PG_PASS:?set PG_PASS}"
DB="${PG_DB:?set PG_DB}"
TABLE="${PG_TABLE:?set PG_TABLE}"
WHERE="${PG_WHERE:-}"
LIMIT="${PG_LIMIT:-100}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUST_BIN="$ROOT/plugins/postgresql/postgresql-plugin"
GO_BIN="/tmp/postgresql-plugin-go"

if [ ! -x "$RUST_BIN" ]; then
  echo "missing $RUST_BIN — run: sh scripts/build-plugins.sh" >&2
  exit 1
fi
if [ ! -x "$GO_BIN" ]; then
  echo "building Go plugin to $GO_BIN…" >&2
  (cd "$ROOT/plugins/postgresql/.go-archive" && go build -o "$GO_BIN" .)
fi

PARAMS=$(cat <<JSON
{"driver":"postgresql","host":"$HOST","port":$PORT,"database":"$DB","username":"$USER","password":"$PASS","ssl_mode":""}
JSON
)

INIT='{"jsonrpc":"2.0","method":"initialize","params":{"settings":{}},"id":1}'
DATA=$(cat <<JSON
{"jsonrpc":"2.0","method":"get_table_data","params":{"params":$PARAMS,"database":"$DB","table":"$TABLE","limit":$LIMIT,"offset":0,"where":"$WHERE","cursor":""},"id":2}
JSON
)

run() {
  local name="$1" bin="$2" trace_env="$3"
  echo
  echo "=== $name ==="
  local t0 t1
  t0=$(python3 -c 'import time; print(time.time())')
  # Send initialize then data request, then close stdin to exit the plugin.
  printf '%s\n%s\n' "$INIT" "$DATA" | env $trace_env "$bin" >/tmp/bench-out.$$.json 2>/tmp/bench-err.$$.log &
  local pid=$!
  wait $pid || true
  t1=$(python3 -c 'import time; print(time.time())')
  local elapsed
  elapsed=$(python3 -c "print(f'{($t1 - $t0)*1000:.0f}')")
  echo "wall: ${elapsed}ms"
  if [ -s /tmp/bench-err.$$.log ]; then
    echo "--- stderr ---"
    cat /tmp/bench-err.$$.log
  fi
  echo "--- stdout (last response) ---"
  # Print only the 2nd line (the response to get_table_data, id=2).
  sed -n '2p' /tmp/bench-out.$$.json | python3 -c '
import json,sys
raw=sys.stdin.read().strip()
if not raw:
    print("(no response)"); sys.exit(0)
try:
    j=json.loads(raw)
except Exception as e:
    print("invalid json:", e); print(raw[:400]); sys.exit(0)
if j.get("error"):
    print("ERROR:", j["error"])
else:
    r=j.get("result",{})
    cols=r.get("columns",[])
    rows=r.get("rows",[])
    print(f"cols={len(cols)} rows={len(rows)} total={r.get(\"total\")} pk={r.get(\"pk_column\")!r} query_ms={r.get(\"query_ms\")}")
'
  rm -f /tmp/bench-out.$$.json /tmp/bench-err.$$.log
}

run "RUST (with trace)" "$RUST_BIN" "DBM_PG_TRACE=1"
run "GO" "$GO_BIN" ""
