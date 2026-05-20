import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  ArrowRight,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOrgs, fetchOrgHealth, setActiveOrg, deleteOrg, refreshOrgs } from "@/store/orgs";
import { appBg } from "@/lib/styles";
import { cn } from "@/lib/utils";
import { useNavigate } from "@/lib/router-compat";

interface LocalStatus {
  running: boolean;
  pid: number | null;
  port: number | null;
}

/** Full-screen barrier shown when the active org's server is unreachable.
 *  Offers multiple escape paths: start local server (if local), retry, switch
 *  to another org, delete the stale org, or jump to settings to edit URL.
 *  Without these the user gets stuck when a legacy/dead URL was active. */
export function ServerOfflineScreen({ onRecover }: { onRecover: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { orgs, activeId } = useOrgs();
  const active = orgs.find((o) => o.id === activeId) ?? null;
  const isLocal = active?.server_kind === "local";
  const otherOrgs = orgs.filter((o) => o.id !== activeId);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>("");
  const [showLogsPanel, setShowLogsPanel] = useState(false);
  const [localStatus, setLocalStatus] = useState<LocalStatus | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!isLocal) return;
    void invoke<LocalStatus>("local_server_status").then(setLocalStatus).catch(() => undefined);
  }, [isLocal]);

  async function retry() {
    if (!active?.server_url) return;
    setBusy(true);
    setError(null);
    try {
      await fetchOrgHealth(active.server_url);
      onRecover();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function startLocal() {
    setBusy(true);
    setError(null);
    try {
      await invoke("start_local_server", { options: { port: 18787, lan: false, admin_token_hash: null } });
      await retry();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function viewLogs() {
    try {
      const out = await invoke<string>("local_server_log_tail", { lines: 80 });
      setLogs(out);
      setShowLogsPanel(true);
    } catch (e) {
      setError(String(e));
    }
  }

  async function switchTo(id: number) {
    setBusy(true);
    try {
      await setActiveOrg(id);
      onRecover();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteActive() {
    if (!active) return;
    setBusy(true);
    try {
      await deleteOrg(active.id);
      // Pick the next org (prefer local) and activate. If none, the boot
      // machinery will route to WelcomePage on its own.
      await refreshOrgs();
      const next = otherOrgs.find((o) => o.server_kind === "local") ?? otherOrgs[0];
      if (next) await setActiveOrg(next.id);
      onRecover();
    } catch (e) {
      setError(String(e));
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main data-tauri-drag-region className={cn("grid h-screen place-items-center px-4 text-text", appBg)}>
      <section
        data-tauri-drag-region="false"
        className="w-full max-w-lg space-y-4 rounded-xl border border-border-subtle bg-surface-overlay p-6 shadow-md"
      >
        <div className="flex items-start gap-3 rounded-md border border-warn/40 bg-warn-soft p-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-warn" />
          <div className="space-y-1 text-body">
            <p className="font-medium text-warn">{t("offline.title")}</p>
            <p className="text-text-muted">
              {t("offline.body", { name: active?.name ?? "?" })}
            </p>
            {active?.server_url && (
              <p className="mt-1 break-all font-mono text-tiny text-text-faint">
                {active.server_url}
              </p>
            )}
          </div>
        </div>

        {error && (
          <p className="break-words rounded-md border border-danger/30 bg-danger-soft/40 p-2 text-tiny text-danger">
            {error}
          </p>
        )}

        {/* Primary actions */}
        <div className="flex flex-wrap items-center gap-2">
          {isLocal && !localStatus?.running && (
            <Button variant="primary" size="sm" onClick={startLocal} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {t("offline.startLocal")}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={retry} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {t("offline.retry")}
          </Button>
          {isLocal && (
            <Button variant="ghost" size="sm" onClick={viewLogs} disabled={busy}>
              {t("offline.viewLogs")}
            </Button>
          )}
        </div>

        {showLogsPanel && logs && (
          <pre className="max-h-48 overflow-auto rounded-md border border-border-subtle bg-surface-sunken p-2 text-tiny font-mono text-text-muted">
            {logs}
          </pre>
        )}

        {/* Escape hatch: other orgs */}
        {otherOrgs.length > 0 && (
          <div className="space-y-1.5 border-t border-border-subtle pt-3">
            <p className="text-overline">Cambiar de organización</p>
            <div className="flex flex-col gap-1">
              {otherOrgs.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => switchTo(o.id)}
                  disabled={busy}
                  className="group flex items-center gap-2 rounded-md border border-border-subtle bg-surface-elevated px-3 py-2 text-left transition-colors hover:border-border-strong hover:bg-surface-hover disabled:opacity-50"
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: o.accent_color ?? "#71717a" }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-body truncate font-medium text-text">{o.name}</p>
                    <p className="text-tiny truncate font-mono text-text-faint">
                      {o.server_url ?? "—"} · {o.server_kind}
                    </p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-text-faint transition-transform group-hover:translate-x-0.5" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Settings + delete */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/settings/organizations")}
            disabled={busy}
          >
            <Plus className="h-3.5 w-3.5" /> Añadir nueva organización
          </Button>
          {active && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              className="ml-auto text-danger hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" /> Eliminar esta organización
            </Button>
          )}
        </div>

        {confirmDelete && active && (
          <div className="space-y-2 rounded-md border border-danger/40 bg-danger-soft/30 p-3">
            <p className="text-body text-danger">
              ¿Eliminar <span className="font-semibold">{active.name}</span> localmente? El server remoto no se ve afectado.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button variant="danger" size="sm" onClick={deleteActive} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Eliminar
              </Button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
