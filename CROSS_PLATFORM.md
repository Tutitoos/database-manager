# Cross-platform notes — Database Manager

Soportado: macOS, Windows, Linux. Resumen por componente:

## Desktop app (Tauri)

| Capa | macOS | Windows | Linux |
|---|---|---|---|
| Build target | `.app` / `.dmg` | `.msi` / `.exe` | `.deb` / `.AppImage` |
| Keyring (master key cache) | Keychain | Credential Manager | libsecret |
| Deep-link `database-manager://` | LaunchServices auto | Registry auto | `.desktop` MIME |
| `shell.open` (browser OAuth) | `open` | `start` | `xdg-open` |

### Build per OS

```sh
# en cada SO
pnpm install
pnpm plugins:build      # plugins Go: postgresql / mongodb / redis
pnpm tauri:build        # bundle nativo
```

Salida en `src-tauri/target/release/bundle/`:
- macOS: `macos/*.app`, `dmg/*.dmg`
- Windows: `msi/*.msi`, `nsis/*.exe`
- Linux: `deb/*.deb`, `appimage/*.AppImage`

### Deep-link

`tauri.conf.json` declara el scheme:
```json
"plugins": { "deep-link": { "desktop": { "schemes": ["database-manager"] } } }
```

- macOS: `tauri build` graba `CFBundleURLTypes` en `Info.plist`. Tras instalar `.app`, scheme funciona.
- Windows: `tauri build` graba el scheme en HKCU/HKCR via instalador `.msi`/`.nsis`.
- Linux: el bundle `.deb` instala `database-manager.desktop` con `MimeType=x-scheme-handler/database-manager;`. AppImage requiere registro manual:
  ```sh
  xdg-mime default database-manager.desktop x-scheme-handler/database-manager
  update-desktop-database ~/.local/share/applications
  ```

En **dev mode** (`pnpm tauri:dev`), macOS/Windows pueden no registrar el scheme. Build una vez (`pnpm tauri:build`) para registrar, luego sigue con dev.

### Keyring fallback

Si Linux no tiene libsecret (gnome-keyring/kwallet), `auth_unlock`/`auth_set_passphrase` siguen funcionando — el master key vive en memoria mientras la app está abierta y se re-deriva en cada lanzamiento. El usuario reintroduce passphrase cada arranque. La opción ideal: instalar `gnome-keyring` o `keepassxc` con secret-service.

### Plugins Go

`plugins:build` compila para el OS actual. Para releases multi-OS, cross-compila:
```sh
# desde cualquier OS con go
GOOS=linux   GOARCH=amd64 go build -o plugins/<name>/<name>-plugin ./plugins/<name>
GOOS=windows GOARCH=amd64 go build -o plugins/<name>/<name>-plugin.exe ./plugins/<name>
GOOS=darwin  GOARCH=arm64 go build -o plugins/<name>/<name>-plugin ./plugins/<name>
GOOS=darwin  GOARCH=amd64 go build -o plugins/<name>/<name>-plugin ./plugins/<name>
```

El `manifest.json` define `"executable": "./<name>-plugin"`. En Windows Tauri ejecuta `<name>-plugin.exe` automáticamente si lo encuentra.

## Sync server (`dbm-server`)

Binary Rust standalone, sin deps OS-specific:
```sh
cargo build --release -p dbm-server
```

Funciona en macOS/Linux/Windows. Para producción usa Docker (ver `server/Dockerfile`) en cualquier VPS Linux x86_64/arm64.

OAuth callback URL **debe coincidir** con el registrado en el provider. Si pones `PUBLIC_BASE_URL=https://sync.example.com` el callback registrado debe ser `https://sync.example.com/api/auth/callback/github`.

## Limitaciones conocidas

- Linux sin libsecret: passphrase no se cachea entre sesiones de la app.
- Linux AppImage: scheme deep-link requiere `xdg-mime default` manual la primera vez.
- En Linux Wayland algunas distros no exponen `host` header esperado al server detrás de proxy — usa siempre `PUBLIC_BASE_URL` explícito en producción.

## Troubleshooting Linux

### Ventana gris + errores nvidia / GBM / DRM_IOCTL_MODE_CREATE_DUMB

Síntoma (NVIDIA propietario + WebKitGTK):
```
src/nv_gbm.c:288: GBM-DRV error (nv_gbm_create_device_native): nv_common_gbm_create_device failed (ret=-1)
KMS: DRM_IOCTL_MODE_CREATE_DUMB failed: Permiso denegado
Failed to create GBM buffer of size 1280x800: Permiso denegado
```

Causa: el renderer DMA-BUF de WebKitGTK no es compatible con el driver propietario de NVIDIA en muchas distros (Debian 12, Ubuntu 22.04/24.04).

Fix: la app ya fuerza `WEBKIT_DISABLE_DMABUF_RENDERER=1` + `WEBKIT_DISABLE_COMPOSITING_MODE=1` en `src-tauri/src/lib.rs` antes de inicializar WebKit. Si todavía ves la ventana gris al lanzar el binario, exporta las variables manualmente:

```sh
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
/usr/bin/database-manager   # o ruta del AppImage / .deb
```

Para hacerlo permanente edita el `.desktop` (`/usr/share/applications/database-manager.desktop` o `~/.local/share/applications/database-manager.desktop`):
```
Exec=env WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 database-manager %u
```

Otras alternativas si persiste:
- Wayland en lugar de X11 (gnome-shell): suele funcionar mejor con NVIDIA recientes.
- Forzar render por software: `LIBGL_ALWAYS_SOFTWARE=1` (lento pero estable como diagnóstico).
- Actualizar nvidia driver a versión ≥ 535 con `nvidia-drm.modeset=1` en kernel cmdline.
