# Database Manager

Desktop-only database manager built with Tauri v2, Next.js static export, Tailwind v4 and shadcn-style components.

## Development

Install the required toolchains first:

- Node.js + pnpm
- Rust + Cargo
- Go

Then install dependencies and build the local plugins:

```bash
pnpm install
pnpm plugins:build
pnpm tauri:dev
```

The app stores local state in Tauri's app data directory as `db.sqlite`. At startup it seeds the app data `plugins` directory from this repo's `plugins` folder when missing.
