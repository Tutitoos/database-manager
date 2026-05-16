#!/usr/bin/env python3
"""A/B benchmark: Rust pg plugin vs Go pg plugin.

Drives plugin over stdin/stdout JSON-RPC, keeps stdin open until both
responses arrive (otherwise plugin exits before spawned tokio tasks finish).

Env vars: PG_HOST PG_PORT PG_USER PG_PASS PG_DB PG_TABLE
Optional: PG_WHERE PG_LIMIT
"""

from __future__ import annotations
import json
import os
import select
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUST_BIN = ROOT / "plugins" / "postgresql" / "postgresql-plugin"
GO_BIN = Path("/tmp/postgresql-plugin-go")


def require(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        print(f"missing env var {name}", file=sys.stderr)
        sys.exit(1)
    return v


def build_requests() -> tuple[str, str, dict]:
    params = {
        "driver": "postgresql",
        "host": require("PG_HOST"),
        "port": int(require("PG_PORT")),
        "database": require("PG_DB"),
        "username": require("PG_USER"),
        "password": require("PG_PASS"),
        "ssl_mode": "",
    }
    init = {"jsonrpc": "2.0", "method": "initialize", "params": {"settings": {}}, "id": 1}
    data = {
        "jsonrpc": "2.0",
        "method": "get_table_data",
        "params": {
            "params": params,
            "database": params["database"],
            "table": require("PG_TABLE"),
            "limit": int(os.environ.get("PG_LIMIT", "100")),
            "offset": 0,
            "where": os.environ.get("PG_WHERE", ""),
            "cursor": "",
        },
        "id": 2,
    }
    return json.dumps(init), json.dumps(data), data


def run(name: str, binary: Path, env_extra: dict[str, str], init_line: str, data_line: str) -> None:
    print()
    print(f"=== {name} ===")
    if not binary.exists():
        print(f"missing binary: {binary}")
        return
    env = os.environ.copy()
    env.update(env_extra)
    t0 = time.time()
    proc = subprocess.Popen(
        [str(binary)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    assert proc.stdin and proc.stdout and proc.stderr
    proc.stdin.write((init_line + "\n" + data_line + "\n").encode())
    proc.stdin.flush()

    responses: list[str] = []
    timestamps: list[int] = []
    deadline = t0 + 90  # 90s hard cap
    while len(responses) < 2 and time.time() < deadline:
        ready, _, _ = select.select([proc.stdout], [], [], 0.5)
        if proc.stdout in ready:
            line = proc.stdout.readline()
            if not line:
                break
            responses.append(line.decode("utf-8", errors="replace").rstrip("\n"))
            timestamps.append(int((time.time() - t0) * 1000))
    wall_ms = int((time.time() - t0) * 1000)
    for i, ts in enumerate(timestamps):
        print(f"recv id={i+1} at {ts}ms")

    # Drain stderr non-blocking
    try:
        proc.stdin.close()
    except Exception:
        pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    err = proc.stderr.read().decode("utf-8", errors="replace")

    print(f"wall: {wall_ms}ms")
    if err.strip():
        print("--- stderr ---")
        print(err.rstrip())
    print("--- responses ---")
    if len(responses) < 2:
        print(f"(only {len(responses)}/2 responses received before timeout)")
    for raw in responses:
        try:
            j = json.loads(raw)
        except Exception as e:
            print(f"invalid json: {e}: {raw[:200]}")
            continue
        rid = j.get("id")
        if j.get("error"):
            print(f"id={rid} ERROR: {j['error']}")
            continue
        r = j.get("result")
        if isinstance(r, dict) and "columns" in r:
            cols = r.get("columns") or []
            rows = r.get("rows") or []
            print(
                f"id={rid} cols={len(cols)} rows={len(rows)} total={r.get('total')} "
                f"pk={r.get('pk_column')!r} estimated={r.get('is_estimated')} query_ms={r.get('query_ms')}"
            )
        else:
            print(f"id={rid} result={r}")


def main() -> None:
    init_line, data_line, parsed = build_requests()
    print(f"PG: {parsed['params']['params']['host']}:{parsed['params']['params']['port']}/{parsed['params']['database']}  table={parsed['params']['table']}  where={parsed['params']['where']!r}  limit={parsed['params']['limit']}")
    run("RUST (with trace)", RUST_BIN, {"DBM_PG_TRACE": "1"}, init_line, data_line)
    run("GO", GO_BIN, {}, init_line, data_line)


if __name__ == "__main__":
    main()
