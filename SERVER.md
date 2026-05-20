# dbm-server — Self-host guide

Self-hosted backend for Database Manager. **Source of truth for everything**:
connections, groups, credentials, workspace sessions, plugin enablement. The
desktop app is a thin HTTP client on top of this. Run one instance per org.

## Quick start

```bash
cd server
cargo build --release
./run.sh
# → listening on http://127.0.0.1:8787
# → mDNS announce: <hostname>._dbm._tcp.local. at <ip>:<port>
```

## Configuration

All settings via env vars.

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | TCP port |
| `BIND_ADDR` | `0.0.0.0` | Bind address. `127.0.0.1` → plain HTTP. Anything else → **self-signed TLS auto-generated** in `data_dir/cert.pem` + `key.pem` (TOFU pinning on client) |
| `DATABASE_URL` | `./data/server.db` | SQLite path |
| `SERVER_NAME` | `Database Manager` | Display name in `/health` |
| `ACCENT_COLOR` | none | Hex accent in `/health` |
| `MIN_CLIENT_VERSION` | none | Strict version gate — clients older than this are blocked at boot |
| `DBM_SERVER_KEY` | lazy-gen | Base64 32-byte AES-256-GCM KEK for at-rest encryption (connection passwords, credential secrets). Generated at `data_dir/dbm.key` if missing |
| `PLUGINS_SIGNING_KEY` | ephemeral | Base64 32-byte Ed25519 seed for plugin manifest signing |
| `DBM_LOCAL_ADMIN_HASH` | none | Argon2id hash of the local-server bearer token. Set by the desktop client at spawn time when the user creates the Local org. Allows the loopback client to authenticate without OAuth |
| `DBM_PLUGINS_DIR` | `./plugins` | Where server-side plugin binaries live (used by `/api/plugins_exec`) |
| `DISCORD_CLIENT_ID/SECRET`, `GITHUB_*`, `GOOGLE_*`, `MICROSOFT_*` | none | OAuth provider keys (remote orgs only) |

## Plugin signing

The server signs every plugin manifest with Ed25519. The client fetches the pubkey
from `/health.plugin_signing_pubkey_b64` and refuses to install any plugin whose
signature doesn't verify.

**Generate a persistent signing key** (recommended for production):

```bash
# 32 random bytes, base64-encoded
openssl rand -base64 32 > /etc/dbm/signing.key
export PLUGINS_SIGNING_KEY=$(cat /etc/dbm/signing.key)
```

Without `PLUGINS_SIGNING_KEY`, the server generates an ephemeral key per restart.
Clients will see a different pubkey after each restart and re-trust manually.

### Adding a plugin

```
./plugins/
└── mysql-plugin/
    ├── manifest.json      # { "id": "mysql", "name": "MySQL", "version": "0.5.0", "platforms": ["macos","linux"], "download_url": "https://...", "checksum_sha256": "abcd..." }
    └── binary             # actual .dylib/.so/.dll (referenced by download_url)
```

The server hashes the binary, signs the manifest, and serves it at `/api/plugins`.

## TLS

The client uses TOFU pinning: on first connection it captures the leaf cert
SHA256. Subsequent connections must present the same fingerprint or the user is
prompted to confirm the change.

For production:

```bash
# Let's Encrypt example
certbot certonly --standalone -d sync.example.com
export DBM_TLS_CERT=/etc/letsencrypt/live/sync.example.com/fullchain.pem
export DBM_TLS_KEY=/etc/letsencrypt/live/sync.example.com/privkey.pem
```

Self-signed certs work too — clients warn once at add-org time, then pin.

## mDNS discovery

The server announces `_dbm._tcp.local.` so clients on the same network show it
in the "Add organization" wizard. Disable with `DBM_MDNS_DISABLE=1`.

Windows clients need Apple Bonjour running. macOS/Linux work out of the box.

## RBAC roles

- **owner** — full control, can delete the org
- **admin** — invite/remove members, change roles (except owner)
- **member** — read/write sync data
- **viewer** — read-only, push requests rejected with 403

First user to create an org becomes owner. Subsequent users join via invite token.

## Invites

`POST /api/orgs/:org_id/members` (admin+) returns a one-time token + `dbmgr://invite/<token>`
deep-link. Anyone clicking it opens the client, fetches invite metadata, and
joins as the role the inviter chose.

Tokens expire 7 days after creation.

## Backup

The whole server state lives in one SQLite file. Stop the process, copy
`dbm.sqlite`, restart. Or use the SQLite online backup API while running.

## Upgrades

```bash
git pull
cargo build --release
systemctl restart dbm-server   # or however you run it
```

Plugin signing key stays stable across restarts iff `PLUGINS_SIGNING_KEY` is
persisted. Clients re-fetch manifests automatically.

## Reverse proxy

Recommended for production. Nginx example:

```nginx
server {
    listen 443 ssl http2;
    server_name sync.example.com;
    ssl_certificate     /etc/letsencrypt/live/sync.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sync.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

When fronted by a proxy with a different cert, set `DBM_TLS_*` to empty (server
runs HTTP behind the proxy) and the client pins the proxy's cert.

## Logs

The server uses `tracing`. Defaults to `INFO`. Override via `RUST_LOG`:

```bash
RUST_LOG=debug,sqlx=warn ./run.sh
```

## HTTP API surface

Authenticated by Bearer token (either OAuth session for remote orgs or the
passphrase-derived admin token for the local server).

```
GET    /health                              public, includes plugin_signing_pubkey_b64
GET    /api/connections?org_id=<id>         list (RBAC: member+)
POST   /api/connections?org_id=<id>         create (RBAC: member+; viewer blocked)
GET    /api/connections/:id
PATCH  /api/connections/:id
DELETE /api/connections/:id
GET    /api/groups                          (same RBAC pattern)
POST   /api/groups
PATCH  /api/groups/:id
DELETE /api/groups/:id
GET    /api/credentials
POST   /api/credentials                     secret cifrado AES-256-GCM at-rest
PATCH  /api/credentials/:id
DELETE /api/credentials/:id
GET    /api/credentials/:id                 viewer recibe metadata, no plaintext
GET    /api/workspaces?org_id=<id>          tabs + filtros UI (per user+org)
PUT    /api/workspaces?org_id=<id>          replace snapshot (last-write-wins)
GET    /api/plugins_installed?org_id=<id>
PUT    /api/plugins_installed/:plugin_id    enable/upsert (RBAC: admin+)
DELETE /api/plugins_installed/:plugin_id
POST   /api/plugins_exec/:plugin_id/exec    server-side plugin runtime (opt-in)
```

## Plugin server-side mode (opt-in)

When a manifest exposes `binary_server_url`, clients can toggle
`app.plugins_server_mode = true` and queries proxy via
`POST /api/plugins_exec/<id>/exec { op, args, org_id }`. The server spawns the
plugin binary (at `$DBM_PLUGINS_DIR/<id>/binary_server`), pipes the request
JSON to stdin, reads one JSON line back from stdout, returns it.

**Sandboxing is not yet enabled** in this iteration — the plugin runs with the
server's full process privileges. macOS `sandbox-exec` / Linux `seccomp` /
Windows Job Objects come in a follow-up. Trust your plugin sources accordingly.

## Migration from a global `sync.server_url`

Old clients that had a single `sync.server_url` setting migrate automatically
on first launch: a `Default` org is created using that URL plus a local-only
`Local` org. Existing connections/credentials/groups become scoped to `Default`.

No server-side action required.
