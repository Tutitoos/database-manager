import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  FileText,
  Loader2,
  Play,
  Power,
  RefreshCw,
  Server,
  Trash2,
  Upload,
  Wifi,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { pushToast } from "@/components/ui/toast";
import { SettingsCard, SettingsRow } from "@/components/settings/SettingsCard";
import { cn } from "@/lib/utils";

interface LocalStatus {
  running: boolean;
  pid: number | null;
  port: number | null;
  bind: string | null;
  uptime_secs: number | null;
  log_path: string | null;
}

interface DerivedToken { token: string; hash: string }

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function formatUptime(secs: number | null): string {
  if (secs == null) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Extract a human-readable error reason from the log tail.
 *
 *  Priority order matters: tower's HTTP middleware spams `ERROR ... Status
 *  code: 500` on every failed request, which drowns out the actually
 *  diagnostic line (`Address already in use`, panic, etc.) that explains why
 *  the server is stopped. We scan high-signal patterns first and fall back to
 *  generic ERROR markers only when no specific cause is present.
 */
function extractLastError(raw: string): string | null {
  if (!raw) return null;
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(-200);

  const highSignal = [
    /address already in use/i,
    /permission denied/i,
    /panicked/i,
    /fatal/i,
    /failed to bind/i,
    /could not (?:open|create|read)/i,
  ];
  // Walk tail backwards so we surface the most recent high-signal hit.
  for (let i = tail.length - 1; i >= 0; i--) {
    if (highSignal.some((re) => re.test(tail[i]))) {
      return tail[i].slice(0, 280);
    }
  }
  // Fall back to a generic ERROR line — but skip noisy tower trace failures
  // which are downstream symptoms, not root causes.
  for (let i = tail.length - 1; i >= 0; i--) {
    const l = tail[i];
    if (/tower_http::trace|Status code:/i.test(l)) continue;
    if (/\bERROR\b|\bError:/.test(l)) return l.slice(0, 280);
  }
  return null;
}

/** Quick local check: is the TCP port already in use on 127.0.0.1?
 *  Fetches a short timeout request to the port and treats any response as
 *  "occupied". Useful before suggesting a port bump. */
async function isPortOccupied(p: number): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), 600);
    await fetch(`http://127.0.0.1:${p}/health`, { signal: ctrl.signal });
    clearTimeout(id);
    return true;
  } catch {
    return false;
  }
}

async function nextFreePort(start: number, max = 10): Promise<number | null> {
  for (let p = start + 1; p < start + 1 + max; p++) {
    if (!(await isPortOccupied(p))) return p;
  }
  return null;
}

export default function LocalServerPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [autostart, setAutostart] = useState(false);
  const [port, setPort] = useState<number>(18787);
  const [lan, setLan] = useState(false);
  const [logsRaw, setLogsRaw] = useState("");
  const [logsOpen, setLogsOpen] = useState(false);
  const [autoRefreshLogs, setAutoRefreshLogs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logBusy, setLogBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const portInputRef = useRef<HTMLInputElement>(null);

  const logs = useMemo(() => stripAnsi(logsRaw), [logsRaw]);
  const lastError = useMemo(() => extractLastError(logs), [logs]);
  const portConflict = lastError?.toLowerCase().includes("address already in use") ?? false;

  const refresh = useCallback(async () => {
    const [st, as] = await Promise.all([
      invoke<LocalStatus>("local_server_status").catch(() => null),
      invoke<boolean>("autostart_status").catch(() => false),
    ]);
    setStatus(st);
    setAutostart(as);
    if (st?.port) setPort(st.port);
    if (st?.bind) setLan(st.bind === "0.0.0.0");
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => { void refresh(); }, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  // Auto-tail when the user pins the logs panel + has auto-refresh on.
  useEffect(() => {
    if (!logsOpen || !autoRefreshLogs) return;
    const id = setInterval(() => { void tailLogs(true); }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logsOpen, autoRefreshLogs]);

  // Surface the last error in the logs even before the user opens the panel —
  // boot a silent tail when the server is stopped so the offline banner has
  // context to show.
  useEffect(() => {
    if (status && !status.running && !logsRaw) {
      void tailLogs(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.running]);

  async function readToken(): Promise<string | null> {
    const stored = await invoke<string | null>("get_app_setting", { key: "local.admin_token" })
      .catch(() => null);
    if (stored) {
      try { return JSON.parse(stored) as string; }
      catch { return stored; }
    }
    return null;
  }

  async function ensureToken(): Promise<{ token: string; hash: string | null }> {
    const existing = await readToken();
    if (existing) return { token: existing, hash: null };
    const derived = await invoke<DerivedToken>("gen_local_admin_token");
    await invoke("set_app_setting", {
      key: "local.admin_token",
      valueJson: JSON.stringify(derived.token),
    });
    return { token: derived.token, hash: derived.hash };
  }

  async function startServer() {
    setBusy(true);
    try {
      const { hash } = await ensureToken();
      await invoke("start_local_server", { options: { port, lan, admin_token_hash: hash } });
      pushToast({ level: "success", title: t("localServer.toasts.started") });
      await refresh();
      // refresh log tail so the banner clears if the start succeeded.
      void tailLogs(true);
    } catch (e) {
      pushToast({ level: "danger", title: t("localServer.toasts.startFail"), body: String(e) });
      void tailLogs(true);
    } finally {
      setBusy(false);
    }
  }

  async function stopServer() {
    setBusy(true);
    try {
      await invoke("stop_local_server");
      pushToast({ level: "info", title: t("localServer.toasts.stopped") });
      await refresh();
    } catch (e) {
      pushToast({ level: "danger", title: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function restart() {
    setBusy(true);
    try {
      await invoke("stop_local_server").catch(() => undefined);
      const { hash } = await ensureToken();
      await invoke("start_local_server", { options: { port, lan, admin_token_hash: hash } });
      pushToast({ level: "success", title: t("localServer.toasts.restarted") });
      await refresh();
      void tailLogs(true);
    } catch (e) {
      pushToast({ level: "danger", title: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function tailLogs(silent = false) {
    if (!silent) setLogBusy(true);
    try {
      const out = await invoke<string>("local_server_log_tail", { lines: 300 });
      setLogsRaw(out);
      if (!silent) setLogsOpen(true);
    } catch (e) {
      if (!silent) pushToast({ level: "danger", title: String(e) });
    } finally {
      if (!silent) setLogBusy(false);
    }
  }

  async function copyLogs() {
    if (!logs) return;
    try {
      await navigator.clipboard.writeText(logs);
      pushToast({ level: "success", title: t("localServer.toasts.logsCopied") });
    } catch (e) {
      pushToast({ level: "danger", title: String(e) });
    }
  }

  async function toggleAutostart(v: boolean) {
    setBusy(true);
    try {
      if (v) {
        const { hash } = await ensureToken();
        if (!hash) {
          pushToast({
            level: "warn",
            title: t("localServer.toasts.tokenWarnTitle"),
            body: t("localServer.toasts.tokenWarnBody"),
          });
        }
        const finalHash = hash ?? (await invoke<DerivedToken>("gen_local_admin_token")).hash;
        await invoke("enable_autostart", { options: { port, admin_token_hash: finalHash } });
        pushToast({ level: "success", title: t("localServer.toasts.autostartOn") });
      } else {
        await invoke("disable_autostart");
        pushToast({ level: "info", title: t("localServer.toasts.autostartOff") });
      }
      await refresh();
    } catch (e) {
      pushToast({ level: "danger", title: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function suggestFreePort() {
    const found = await nextFreePort(port);
    if (found) {
      setPort(found);
      pushToast({ level: "info", title: `Puerto sugerido: ${found}` });
      portInputRef.current?.focus();
    } else {
      pushToast({ level: "warn", title: "No se encontró puerto libre cerca" });
    }
  }

  async function handleUpload(file: File) {
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buf));
      await invoke("upload_local_plugin", { filename: file.name, bytes });
      pushToast({ level: "success", title: t("localServer.toasts.uploadOk"), body: file.name });
    } catch (e) {
      pushToast({ level: "danger", title: t("localServer.toasts.uploadFail"), body: String(e) });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const running = status?.running ?? false;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 pb-12">
      <header className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg border border-border-subtle bg-surface-elevated text-text">
          <Server strokeWidth={1.5} className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h1 className="text-h1 text-text">{t("localServer.title")}</h1>
          <p className="text-caption text-text-muted">{t("localServer.subtitle")}</p>
        </div>
      </header>

      {/* Hero status block — combines state, metrics, and primary actions in a
          single visual unit so the user always sees process health first. */}
      <section className="overflow-hidden rounded-lg border border-border-subtle bg-surface-elevated">
        <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3">
          <StatusBadge running={running} />
          <div className="ml-auto flex items-center gap-1.5">
            {running ? (
              <>
                <Button variant="secondary" size="sm" onClick={restart} disabled={busy}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {t("localServer.actions.restart")}
                </Button>
                <Button variant="danger" size="sm" onClick={stopServer} disabled={busy}>
                  <Power className="h-3.5 w-3.5" /> {t("localServer.actions.stop")}
                </Button>
              </>
            ) : (
              <Button variant="primary" size="sm" onClick={startServer} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {t("localServer.actions.start")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (logsOpen ? setLogsOpen(false) : void tailLogs())}
              disabled={logBusy}
              title={logsOpen ? t("localServer.actions.hideLogs") : t("localServer.actions.viewLogs")}
            >
              {logBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              {logsOpen ? t("localServer.actions.hideLogs") : t("localServer.actions.viewLogs")}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-border-subtle">
          <StatCell label="PID" value={status?.pid ?? "—"} />
          <StatCell label={t("localServer.status.bind")} value={status?.bind && status?.port ? `${status.bind}:${status.port}` : "—"} mono />
          <StatCell label={t("localServer.status.uptime")} value={formatUptime(status?.uptime_secs ?? null)} />
        </div>

        {/* Inline error banner: surfaces the most relevant log line so the user
            doesn't have to expand the logs panel to know why start failed. */}
        {!running && lastError && (
          <div className="flex items-start gap-2 border-t border-amber-900/30 bg-amber-950/20 px-4 py-2 text-caption text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-amber-100">
                {portConflict ? t("localServer.errors.portInUse") : t("localServer.errors.lastError")}
              </p>
              <p className="mt-0.5 break-words font-mono text-tiny text-amber-200/80">{lastError}</p>
              {portConflict && (
                <p className="mt-1 text-tiny text-amber-200/70">
                  {t("localServer.errors.portConflictHint", { port })}
                </p>
              )}
            </div>
            {portConflict && (
              <Button variant="secondary" size="sm" onClick={suggestFreePort}>
                Sugerir puerto libre
              </Button>
            )}
          </div>
        )}
      </section>

      <SettingsCard title={t("localServer.config.title")}>
        <SettingsRow
          label={t("localServer.config.port")}
          description={
            running && status?.port && status.port !== port
              ? `Aplicado al reiniciar — actualmente bindeado a :${status.port}.`
              : t("localServer.config.portHint")
          }
          control={
            <Input
              ref={portInputRef}
              type="number"
              className="h-8 w-24 text-right font-mono"
              value={port}
              min={1024}
              max={65535}
              onChange={(e) => setPort(Number(e.target.value) || 18787)}
            />
          }
        />
        <SettingsRow
          label={
            <span className="inline-flex items-center gap-1.5">
              <Wifi className="h-3.5 w-3.5" /> {t("localServer.config.lan")}
            </span>
          }
          description={t("localServer.config.lanHint")}
          control={<Switch checked={lan} onCheckedChange={setLan} />}
        />
        <SettingsRow
          label={t("localServer.config.autostart")}
          description={t("localServer.config.autostartHint")}
          control={<Switch checked={autostart} onCheckedChange={toggleAutostart} />}
        />
      </SettingsCard>

      {logsOpen && (
        <SettingsCard title={t("localServer.logs.title")}>
          <div className="flex items-center gap-1.5 border-b border-border-subtle px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void tailLogs()}
              disabled={logBusy}
              title="Recargar"
            >
              {logBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Recargar
            </Button>
            <label className="text-tiny inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border-subtle px-2 py-1 text-text-muted hover:text-text">
              <input
                type="checkbox"
                checked={autoRefreshLogs}
                onChange={(e) => setAutoRefreshLogs(e.target.checked)}
                className="h-3 w-3 accent-accent"
              />
              Auto
            </label>
            <span className="text-tiny text-text-faint">
              {logs ? `${logs.split("\n").filter(Boolean).length} líneas` : "vacío"}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <Button variant="ghost" size="sm" onClick={copyLogs} disabled={!logs}>
                <Copy className="h-3 w-3" /> Copiar
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setLogsRaw(""); setLogsOpen(false); }}>
                <Trash2 className="h-3 w-3" /> {t("localServer.logs.clear")}
              </Button>
            </div>
          </div>
          <pre className="max-h-80 overflow-auto bg-surface-sunken p-3 text-tiny font-mono leading-snug text-text-muted">
            {logs || "Sin logs todavía."}
          </pre>
        </SettingsCard>
      )}

      <SettingsCard
        title={t("localServer.plugins.title")}
        description={t("localServer.plugins.subtitle")}
      >
        <SettingsRow
          label={
            <span className="inline-flex items-center gap-1.5">
              <Upload className="h-3.5 w-3.5" /> {t("localServer.plugins.upload")}
            </span>
          }
          description={
            running
              ? t("localServer.plugins.uploadHint")
              : t("localServer.plugins.serverStoppedHint")
          }
          control={
            <>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept=".so,.dylib,.dll,.zip,.tar.gz"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUpload(f);
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={busy || !running}
                title={running ? "" : t("localServer.plugins.serverStopped")}
              >
                <Upload className="h-3.5 w-3.5" /> {t("localServer.plugins.choose")}
              </Button>
            </>
          }
        />
      </SettingsCard>
    </div>
  );
}

function StatusBadge({ running }: { running: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-body font-medium",
        running
          ? "border-success/40 bg-success-soft text-success"
          : "border-border-subtle bg-surface-sunken text-text-muted",
      )}
    >
      {running ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      {running ? "Running" : "Stopped"}
    </span>
  );
}

function StatCell({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-2.5">
      <span className="text-overline">{label}</span>
      <span className={cn("truncate text-body text-text", mono && "font-mono")}>{value}</span>
    </div>
  );
}
