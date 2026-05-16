#!/usr/bin/env python3
"""Dump raw get_metrics output from the PG plugin."""
import json
import os
import select
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BIN = ROOT / "plugins" / "postgresql" / "postgresql-plugin"

params = {
    "driver": "postgresql",
    "host": os.environ.get("PG_HOST") or sys.exit("set PG_HOST"),
    "port": int(os.environ.get("PG_PORT") or sys.exit("set PG_PORT")),
    "database": os.environ.get("PG_DB") or sys.exit("set PG_DB"),
    "username": os.environ.get("PG_USER") or sys.exit("set PG_USER"),
    "password": os.environ.get("PG_PASS") or sys.exit("set PG_PASS"),
    "ssl_mode": "",
}

init = json.dumps({"jsonrpc": "2.0", "method": "initialize", "params": {"settings": {}}, "id": 1})
req = json.dumps({"jsonrpc": "2.0", "method": "get_metrics",
                  "params": {"params": params, "database": params["database"]}, "id": 2})

proc = subprocess.Popen(
    [str(BIN)],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
)
proc.stdin.write((init + "\n" + req + "\n").encode())
proc.stdin.flush()

responses = []
deadline = time.time() + 30
while len(responses) < 2 and time.time() < deadline:
    ready, _, _ = select.select([proc.stdout], [], [], 0.5)
    if proc.stdout in ready:
        line = proc.stdout.readline()
        if not line:
            break
        responses.append(line.decode("utf-8", "replace").rstrip("\n"))

try:
    proc.stdin.close()
except Exception:
    pass
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()

if len(responses) < 2:
    print(f"got only {len(responses)}/2 responses")
    print("stderr:", proc.stderr.read().decode())
    sys.exit(1)

j = json.loads(responses[1])
if j.get("error"):
    print("ERROR:", j["error"])
    sys.exit(1)
r = j.get("result", {})
print(f"{'KEY':25} VALUE")
print("-" * 70)
for k in sorted(r):
    v = r[k]
    if isinstance(v, (list, dict)):
        s = json.dumps(v)
        v = s[:80] + ("…" if len(s) > 80 else "")
    print(f"{k:25} {v}")
