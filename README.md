# Database Manager

Desktop database client for PostgreSQL, MongoDB and Redis. Built with Tauri 2 + React 19 + Vite + Tailwind v4. **Server-first architecture**: every install pairs with a `dbm-server` (local or remote) that owns the data. The client is a thin HTTP shell with a TLS-pinned, vault-gated UI on top.

## Architecture (post server-first refactor)

```
Client (Tauri shell) ── HTTP ──► dbm-server (local sidecar or remote self-hosted)
                                  │
                                  ├─ connections, groups, credentials, workspaces
                                  ├─ AES-256-GCM at-rest for secrets
                                  └─ /api/plugins, /api/plugins_exec (server-side runtime opt-in)
```

The client carries no business data of its own — only `app_settings`, the `organizations` catalog and an `sync_outbox` buffer.

## Features

- **First-run wizard** — pick **Local** (embedded `dbm-server` sidecar, autostart, daemon mode optional) or **Remote** (self-hosted Mastodon-style instance). Both flows converge on one global passphrase.
- **Multi-org** — connect to multiple servers. mDNS auto-discovery + manual IP/domain. RBAC per org (Owner/Admin/Member/Viewer). LAN sharing toggle forces self-signed TLS with TOFU pinning.
- **Global vault** — one passphrase per install. Argon2id-derived bearer token authenticates against the local server; Argon2id+ChaCha20-Poly1305 wrap any OAuth tokens for remote orgs.
- **Plugin drivers** — PostgreSQL, MongoDB, Redis as separate Rust binaries. **Client-side mode** (default): downloaded from the active server's `/api/plugins`, signature-verified Ed25519 + SHA256 checksum, executed locally as subprocess JSON-RPC. **Server-side mode** (opt-in): plugin runs on the server and the client proxies operations via `/api/plugins_exec`.
- **Workspace sync** — open tabs and UI filters live on the server (`/api/workspaces`), so the same org on a second device picks up where you left off (last-write-wins).
- **Autostart** — macOS LaunchAgent, Linux systemd-user unit. Windows manual for now.
- **macOS native** — Touch ID / Face ID via Local Authentication, vibrancy, native menubar with keyboard shortcuts, deep links (`database-manager://`).
- **Customizable** — themes, accent color, density, font, zoom (⌘=/⌘-/⌘0), rebindable shortcuts, locale (es/en).

## Development

Required toolchains:

- Node.js 20+ and `pnpm`
- Rust + Cargo (stable)

Install dependencies and run in dev:

```bash
pnpm install
pnpm plugins:build       # build the Rust plugins (postgres, mongo, redis)
pnpm tauri:dev           # run the desktop app
```

Local state lives in the Tauri app data directory as `db.sqlite` (now reduced to `app_settings`, `organizations`, `sync_outbox`). The local server's data lives next to it under `local-server/dbm.sqlite` + `dbm.key` (AES-256 KEK) + optional `cert.pem`/`key.pem` for LAN TLS. Plugins live server-side under `local-server/plugins/<id>/`.

### Running the local server in dev

The `start_local_server` command spawns `target/release/dbm-server` as a child process. Build it once before launching the desktop app in dev:

```bash
cargo build --release -p dbm-server
pnpm tauri:dev
```

For production builds the server binary ships as a Tauri sidecar (`tauri.conf.json.bundle.externalBin`); the CI matrix (macOS arm64/x86_64, Linux x86_64, Windows x86_64) produces the per-target binaries.

See [SERVER.md](SERVER.md) for self-hosting the remote variant.

### Sync server

The optional sync server (`server/`) is an Axum app with SQLite storage:

```bash
cd server
cp .env.example .env     # configure OAuth client IDs, SERVER_NAME, etc.
./run.sh                 # cargo run --release
```

It exposes:

- `GET /health` — server metadata (name, version, accent color, providers, min client version)
- `GET /api/orgs/me` — orgs the authenticated user belongs to
- `POST /api/orgs`, members CRUD, invites — full RBAC
- `POST /api/sync/push` and `GET /api/sync/pull` — org-scoped encrypted sync
- `GET /api/plugins` — list of plugin manifests + SHA256 checksums (reads `./plugins/` dir or `PLUGINS_DIR` env)
- mDNS announce on `_dbm._tcp.local.`

### Adding an organization

1. Start the server (locally or on a VPS).
2. In the desktop app: sidebar → org switcher → **Añadir organización**.
3. Either pick one from the **Descubiertos en tu red** list (mDNS) or type the IP/domain.
4. The wizard fetches `/health`, shows providers, then runs an OAuth flow (Discord/GitHub/Google/Microsoft).

### Vault and keychain

The vault stores a master key per organization. Optional opt-ins:

- **Recordar en este dispositivo** — saves the master key in the OS keychain (macOS Login keychain, libsecret on Linux, Credential Manager on Windows).
- **Touch ID / Face ID** — on macOS, requires the master key to be remembered. Reads use a `LocalAuthentication` prompt before unlocking the vault from the keychain item.

Note: on macOS, items protected with `kSecAttrAccessControl` require a signed app with the `keychain-access-groups` entitlement. The dev build stores the key without ACL and uses LAContext as a UX gate.

## Project layout

```
src/                  React frontend (Vite)
  pages/              Routes (Dashboard, ConnectionsPage, settings/*, sql/, document/, redis/)
  components/         Shared UI (shell, settings cards, ui primitives)
  store/              TanStack stores (sessions, orgs, vault, settings)
  lib/                theme, sync, updates, providers, zoom, sounds, i18n helpers
  i18n/               es.json, en.json
src-tauri/            Tauri commands and Rust glue
  src/auth.rs         Per-org vault, biometry, keychain
  src/orgs.rs         Org CRUD, members, invites, sync_org_plugins
  src/sync.rs         Encrypted push/pull with org_id scoping + outbox
  src/keychain.rs     Cross-platform keychain wrapper
  src/biometry.rs     macOS LAContext prompt
  src/plugins.rs      Plugin process supervision (stdio JSON-RPC)
plugins/              Standalone Rust plugin processes (postgres, mongo, redis)
server/               Axum sync server (orgs, sync, plugins, OAuth)
```

## Building releases

```bash
pnpm tauri:build       # macOS .dmg / Windows .msi / Linux .deb + AppImage
```

CI builds for each platform live in `.github/workflows/release.yml`.

## Keyboard shortcuts

Configurable from **Ajustes → Atajos**. Defaults include:

| Action                  | macOS        |
| ----------------------- | ------------ |
| Command palette         | ⌘K           |
| Toggle sidebar          | ⌘B           |
| Toggle inspector        | ⌘/           |
| Zoom in / out / reset   | ⌘= / ⌘- / ⌘0 |
| New / close tab         | ⌘T / ⌘W      |
| Open settings           | ⌘,           |
| Run query               | ⌘↵           |
| Cancel query            | Esc          |

## License

MIT
