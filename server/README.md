# dbm-server

Standalone Rust backend for Database Manager. Provides OAuth login
(Discord/GitHub/Google/Microsoft) and end-to-end encrypted sync of connections,
folders, credentials and settings.

Stateless except for SQLite. The server never sees plaintext credentials —
every sync envelope is opaque ciphertext encrypted client-side with a key
derived from the user's passphrase.

## Pick one: hosted vs self-host

The desktop app lets each user choose the sync URL:

- **Use a hosted instance** — anyone running `dbm-server` on a public domain.
- **Self-host on your VPS** — follow the steps below.
- **No sync** — leave the field empty; the app stays fully local.

## Local dev

```sh
cd server
cp .env.example .env          # fill in OAuth client_id/secret for at least one provider
cargo run --release           # http://localhost:8787
```

## Self-host on a VPS

### Option A — Docker (recommended)

```sh
# on the VPS
git clone <your fork> dbm
cd dbm/server
cp .env.example .env
# edit .env: set PUBLIC_BASE_URL=https://sync.your-domain.com and OAuth secrets
docker compose up -d --build
```

Then put a reverse proxy (Caddy / nginx / Traefik) in front for TLS:

```caddy
sync.your-domain.com {
    reverse_proxy 127.0.0.1:8787
}
```

### Option B — systemd

```sh
cargo build --release -p dbm-server
sudo install -m 0755 target/release/dbm-server /usr/local/bin/dbm-server
sudo useradd --system --home /var/lib/dbm dbm
sudo install -d -o dbm -g dbm /var/lib/dbm
sudo cp server/.env.example /etc/dbm-server.env
sudo $EDITOR /etc/dbm-server.env
```

`/etc/systemd/system/dbm-server.service`:

```ini
[Unit]
Description=Database Manager sync server
After=network.target

[Service]
Type=simple
User=dbm
EnvironmentFile=/etc/dbm-server.env
Environment=DATABASE_URL=/var/lib/dbm/server.db
ExecStart=/usr/local/bin/dbm-server
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now dbm-server
```

## OAuth provider setup

For each provider, register a redirect URI:

```
https://sync.your-domain.com/api/auth/callback/<provider>
```

Scopes:

| Provider  | Scope                |
|-----------|----------------------|
| discord   | `identify email`     |
| github    | `read:user user:email` |
| google    | `openid email profile` |
| microsoft | `openid email profile` |

Set `PUBLIC_BASE_URL=https://sync.your-domain.com` so the redirect URI matches
what you registered.

## Endpoints

- `GET  /health` — liveness probe
- `GET  /api/auth/sign-in/:provider` — start OAuth, returns 302
- `GET  /api/auth/callback/:provider` — provider redirect target, issues a one-time code, forwards to desktop deep link
- `POST /api/auth/exchange` — `{ code }` → session token + user profile
- `GET  /api/account/me`
- `GET  /api/account/master-key` / `POST /api/account/master-key` — wrapped E2E master key (server stores opaque blob)
- `POST /api/account/sign-out`
- `POST /api/sync/push` — `{ envelopes: [...] }` (ciphertext only)
- `GET  /api/sync/pull?since=<rfc3339>` — envelopes updated after the cursor

## Storage

SQLite WAL at `DATABASE_URL`. Safe for a single instance. For horizontal
scaling swap the rusqlite store for Postgres (same schema). Tables:

- `users` — id, email, name, avatar_url, linked_providers, master_key_enc_blob
- `sessions` — token, user_id, expires_at
- `oauth_codes` — one-time codes used during the OAuth round trip
- `sync_envelopes` — `(user_id, entity_type, entity_id)` → ciphertext + timestamps

## Security notes

- Sessions are 30-day bearer tokens. Rotate by re-logging in.
- Master keys travel as ciphertext only. Compromising the server gives an
  attacker only opaque blobs — no DB credentials.
- Bind to localhost and put TLS at the reverse proxy. Do not expose port 8787
  directly to the internet.
