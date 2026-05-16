import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  KeyRound,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  RefreshCw,
  Save,
  UserCircle2,
  Wifi,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  changePassphrase,
  currentUser,
  DEFAULT_SYNC_SERVER_URL,
  EXAMPLE_SYNC_SERVER_URL,
  getSyncServerUrl,
  lock,
  passphraseStatus,
  setPassphrase,
  setSyncServerUrl,
  signOut,
  unlock,
  type PassphraseStatus,
} from "@/lib/auth";
import { onSyncStatus, syncNow, type SyncStatus } from "@/lib/sync";
import { mutedText, textTitle } from "@/lib/styles";
import type { AppUser } from "@/lib/types";
import { cn } from "@/lib/utils";

type PulseKind = "info" | "error" | "success";
type Pulse = { kind: PulseKind; text: string } | null;

export default function AccountPage() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [passStatus, setPassStatus] = useState<PassphraseStatus>({ configured: false, unlocked: false });
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [oldPass, setOldPass] = useState("");
  const [unlockPass, setUnlockPass] = useState("");
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncStatus, setSyncStatusState] = useState<SyncStatus | null>(null);
  const [pulse, setPulse] = useState<Pulse>(null);

  const [savingServer, setSavingServer] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testStatus, setTestStatus] = useState<null | { ok: boolean; ms: number | null; msg: string; loading: boolean }>(null);

  function pulseInfo(kind: PulseKind, text: string, ttlMs = 2500) {
    setPulse({ kind, text });
    setTimeout(() => setPulse((p) => (p && p.text === text ? null : p)), ttlMs);
  }

  async function refresh() {
    const [u, ps, su] = await Promise.all([currentUser(), passphraseStatus(), getSyncServerUrl()]);
    setUser(u);
    setPassStatus(ps);
    setServerUrl(su ?? DEFAULT_SYNC_SERVER_URL);
    setSyncEnabled(Boolean(su));
  }

  useEffect(() => {
    refresh().catch((e) => pulseInfo("error", String(e), 5000));
    const unsubP = onSyncStatus((s) => setSyncStatusState(s));
    return () => {
      unsubP.then((fn) => fn()).catch(() => undefined);
    };
  }, []);

  function normalizeUrl(raw: string): string {
    return raw.trim().replace(/\/+$/g, "").replace(/\/(health|api.*)$/i, "");
  }
  function validateUrl(raw: string): string | null {
    const v = normalizeUrl(raw);
    if (!v) return "La URL está vacía.";
    if (!/^https?:\/\//i.test(v)) return "Debe empezar por http:// o https://";
    try {
      new URL(v);
    } catch {
      return "URL inválida.";
    }
    return null;
  }

  async function handleSetPassphrase() {
    if (newPass.length < 8) return pulseInfo("error", "Mínimo 8 caracteres.");
    if (newPass !== newPass2) return pulseInfo("error", "Las contraseñas no coinciden.");
    try {
      if (passStatus.configured) {
        await changePassphrase(oldPass, newPass);
      } else {
        await setPassphrase(newPass);
      }
      setNewPass("");
      setNewPass2("");
      setOldPass("");
      pulseInfo("success", "Passphrase actualizada.");
      await refresh();
    } catch (e) {
      pulseInfo("error", String(e), 5000);
    }
  }
  async function handleUnlock() {
    try {
      await unlock(unlockPass);
      setUnlockPass("");
      pulseInfo("success", "Vault desbloqueado.");
      await refresh();
    } catch (e) {
      pulseInfo("error", String(e), 5000);
    }
  }
  async function handleLock() {
    await lock();
    pulseInfo("info", "Vault bloqueado.");
    await refresh();
  }
  async function handleSignOut() {
    await signOut();
    pulseInfo("info", "Sesión cerrada.");
    await refresh();
  }

  async function handleToggleSync(enabled: boolean) {
    setSyncEnabled(enabled);
    if (!enabled) {
      await setSyncServerUrl("");
      pulseInfo("info", "Sync desactivada.");
      await refresh();
    } else if (!serverUrl.trim()) {
      setServerUrl(DEFAULT_SYNC_SERVER_URL);
    }
  }

  async function handleSaveServer() {
    const err = validateUrl(serverUrl);
    if (err) return pulseInfo("error", err);
    const clean = normalizeUrl(serverUrl);
    setSavingServer(true);
    try {
      await setSyncServerUrl(clean);
      setServerUrl(clean);
      setSavedFlash(true);
      pulseInfo("success", "Servidor guardado.");
      setTimeout(() => setSavedFlash(false), 1500);
      await refresh();
    } catch (e) {
      pulseInfo("error", String(e), 5000);
    } finally {
      setSavingServer(false);
    }
  }

  async function handleTestServer() {
    const err = validateUrl(serverUrl);
    if (err) return pulseInfo("error", err);
    const clean = normalizeUrl(serverUrl);
    setTestStatus({ ok: false, ms: null, msg: "Probando…", loading: true });
    const start = Date.now();
    try {
      const res = await fetch(`${clean}/health`, { method: "GET" });
      const ms = Date.now() - start;
      if (!res.ok) {
        setTestStatus({ ok: false, ms, msg: `HTTP ${res.status}`, loading: false });
        return;
      }
      const body = await res.json().catch(() => ({}));
      const okFlag = body && (body.ok === true || body.ok === "true");
      setTestStatus({ ok: !!okFlag, ms, msg: okFlag ? `OK · ${ms}ms` : "Respuesta inesperada", loading: false });
    } catch (e) {
      setTestStatus({ ok: false, ms: null, msg: String(e), loading: false });
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    try {
      const status = await syncNow();
      if (status.status === "idle") {
        pulseInfo("info", "Sin cambios pendientes.");
      } else if (status.error) {
        pulseInfo("error", status.error, 5000);
      } else {
        pulseInfo("success", `Sincronizado · ↑${status.pushed} ↓${status.pulled}`);
      }
    } catch (e) {
      pulseInfo("error", String(e), 5000);
    } finally {
      setSyncing(false);
    }
  }

  const linkedProviders: string[] = (() => {
    if (!user) return [];
    try {
      const parsed = JSON.parse(user.linked_providers);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      {/* Header */}
      <header className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl border border-white/5 bg-white/5">
          <UserCircle2 className="h-5 w-5 text-zinc-300" />
        </div>
        <div>
          <h1 className={textTitle}>Mi cuenta</h1>
          <p className={cn("text-xs", mutedText)}>
            Inicia sesión para sincronizar entre máquinas. La app funciona sin login.
          </p>
        </div>
      </header>

      {/* Profile card */}
      <Card>
        <SectionHeader icon={<UserCircle2 className="h-4 w-4" />} title="Perfil" />
        {!user ? (
          <div className="flex items-center justify-between rounded-md border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-3">
            <p className="text-sm text-zinc-300">No has iniciado sesión.</p>
            <Link to="/login">
              <Button variant="primary" size="sm">
                <LogIn className="h-3.5 w-3.5" /> Iniciar sesión
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {user.avatar_url ? (
                <img src={user.avatar_url} className="h-12 w-12 rounded-full ring-2 ring-zinc-800" alt="" />
              ) : (
                <div className="grid h-12 w-12 place-items-center rounded-full bg-zinc-800 text-zinc-400">
                  <UserCircle2 className="h-6 w-6" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-100">{user.name ?? user.email}</p>
                <p className="truncate text-xs text-zinc-500">{user.email}</p>
              </div>
              <Button variant="danger" size="sm" onClick={handleSignOut}>
                <LogOut className="h-3.5 w-3.5" /> Salir
              </Button>
            </div>
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Providers vinculados
              </p>
              <div className="flex flex-wrap gap-1.5">
                {linkedProviders.length === 0 && (
                  <span className="text-xs text-zinc-500">Ninguno</span>
                )}
                {linkedProviders.map((p) => (
                  <span
                    key={p}
                    className="rounded-full border border-zinc-700/70 bg-zinc-900/60 px-2.5 py-0.5 text-[11px] capitalize text-zinc-300"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Sync card */}
      <Card>
        <SectionHeader
          icon={syncEnabled ? <Cloud className="h-4 w-4 text-sky-400" /> : <CloudOff className="h-4 w-4" />}
          title="Sincronización"
          right={
            <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={syncEnabled}
                onChange={(e) => handleToggleSync(e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-sky-500"
              />
              {syncEnabled ? "Activada" : "Desactivada"}
            </label>
          }
        />
        {syncEnabled ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                URL del servidor
              </label>
              <div className="flex flex-wrap gap-2">
                <Input
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder={EXAMPLE_SYNC_SERVER_URL || "http://localhost:8787"}
                  className="min-w-[260px] flex-1"
                />
                <Button size="sm" variant="secondary" onClick={handleTestServer} disabled={testStatus?.loading}>
                  {testStatus?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
                  Probar
                </Button>
                <Button size="sm" variant="primary" onClick={handleSaveServer} disabled={savingServer}>
                  {savingServer ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : savedFlash ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {savedFlash ? "Guardado" : "Guardar"}
                </Button>
                <Button size="sm" variant="secondary" onClick={handleSyncNow} disabled={!user || syncing}>
                  {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Sync ahora
                </Button>
              </div>
            </div>

            {testStatus && !testStatus.loading && (
              <Badge ok={testStatus.ok}>
                {testStatus.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {testStatus.msg}
              </Badge>
            )}

            {syncStatus && (
              <div className="flex items-center gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-400">
                <span className="font-mono uppercase tracking-wide text-zinc-500">{syncStatus.status}</span>
                <span className="text-zinc-600">·</span>
                <span>↑ {syncStatus.pushed}</span>
                <span>↓ {syncStatus.pulled}</span>
                {syncStatus.error && <span className="ml-2 text-red-400">{syncStatus.error}</span>}
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-zinc-500">
              Usa una instancia hospedada o monta tu propio servidor en VPS (ver{" "}
              <code className="rounded bg-zinc-900 px-1 py-0.5">server/README.md</code>). En local:{" "}
              <code className="rounded bg-zinc-900 px-1 py-0.5">pnpm server</code> →{" "}
              <code className="rounded bg-zinc-900 px-1 py-0.5">http://127.0.0.1:8787</code>.
            </p>
          </div>
        ) : (
          <p className="text-xs text-zinc-500">
            Activa la sincronización para subir conexiones, carpetas y credenciales cifradas a tu cuenta.
          </p>
        )}
      </Card>

      {/* Passphrase card */}
      <Card>
        <SectionHeader
          icon={<KeyRound className="h-4 w-4 text-amber-400" />}
          title="Passphrase E2E"
          right={
            passStatus.configured ? (
              passStatus.unlocked ? (
                <Badge ok>
                  <CheckCircle2 className="h-3 w-3" /> Desbloqueado
                </Badge>
              ) : (
                <Badge ok={false}>
                  <Lock className="h-3 w-3" /> Bloqueado
                </Badge>
              )
            ) : (
              <Badge ok={false}>
                <AlertTriangle className="h-3 w-3" /> Sin configurar
              </Badge>
            )
          }
        />
        <div className="space-y-3">
          <div className="rounded-md border border-amber-900/30 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200/90">
            <AlertTriangle className="mr-1 inline h-3 w-3 -translate-y-px" />
            La passphrase cifra credenciales y datos sincronizados. <strong>Si la olvidas, los datos cifrados se pierden.</strong>
          </div>

          {passStatus.configured && !passStatus.unlocked && (
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="Passphrase"
                value={unlockPass}
                onChange={(e) => setUnlockPass(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              />
              <Button size="sm" variant="primary" onClick={handleUnlock}>
                Desbloquear
              </Button>
            </div>
          )}

          <details className="rounded-md border border-zinc-800/70 bg-zinc-950/40">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs text-zinc-300 hover:text-zinc-100">
              {passStatus.configured ? "Cambiar passphrase" : "Crear passphrase"}
            </summary>
            <div className="space-y-2 border-t border-zinc-800/70 p-3">
              {passStatus.configured && (
                <Input
                  type="password"
                  placeholder="Passphrase actual"
                  value={oldPass}
                  onChange={(e) => setOldPass(e.target.value)}
                />
              )}
              <Input
                type="password"
                placeholder={passStatus.configured ? "Nueva passphrase" : "Passphrase (8+ caracteres)"}
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
              />
              <Input
                type="password"
                placeholder="Confirmar passphrase"
                value={newPass2}
                onChange={(e) => setNewPass2(e.target.value)}
              />
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="primary" onClick={handleSetPassphrase}>
                  {passStatus.configured ? "Cambiar" : "Crear"}
                </Button>
                {passStatus.unlocked && (
                  <Button size="sm" variant="ghost" onClick={handleLock}>
                    <Lock className="h-3.5 w-3.5" /> Bloquear ahora
                  </Button>
                )}
              </div>
            </div>
          </details>
        </div>
      </Card>

      {/* Floating toast */}
      {pulse && (
        <div
          className={cn(
            "pointer-events-none fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs shadow-[0_12px_32px_rgba(0,0,0,.45)] backdrop-blur",
            pulse.kind === "success" && "border-emerald-900/60 bg-emerald-950/60 text-emerald-200",
            pulse.kind === "error" && "border-red-900/60 bg-red-950/60 text-red-200",
            pulse.kind === "info" && "border-zinc-700/60 bg-zinc-900/80 text-zinc-200",
          )}
        >
          {pulse.kind === "success" ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : pulse.kind === "error" ? (
            <XCircle className="h-3.5 w-3.5" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {pulse.text}
        </div>
      )}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/5 bg-zinc-950/40 p-5 shadow-[0_2px_24px_rgba(0,0,0,.25)] backdrop-blur">
      {children}
    </section>
  );
}

function SectionHeader({
  icon,
  title,
  right,
}: {
  icon: React.ReactNode;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-zinc-400">{icon}</span>
        <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
      </div>
      {right}
    </div>
  );
}

function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        ok
          ? "border-emerald-900/60 bg-emerald-950/40 text-emerald-300"
          : "border-amber-900/60 bg-amber-950/40 text-amber-300",
      )}
    >
      {children}
    </span>
  );
}
