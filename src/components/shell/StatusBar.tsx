import { useEffect, useState } from "react";
import { Database, Wifi, WifiOff, CloudOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "@/lib/router-compat";
import { useSessionsStore } from "@/store/sessions";
import { useConnectionStatus } from "@/lib/connection-status";
import { modSymbol } from "@/lib/shortcuts";
import { useOrgs, fetchOrgHealth } from "@/store/orgs";
import { useActiveOrgAccent } from "@/lib/use-active-org-accent";

export function StatusBar({ onCommand }: { onCommand?: () => void }) {
  const { t } = useTranslation();
  const mod = modSymbol();
  const [searchParams] = useSearchParams();
  const connectionId = Number(searchParams.get("id"));
  const { sessions } = useSessionsStore();
  const session = connectionId ? sessions[connectionId] : null;
  const connection = session?.connection ?? null;
  const status = useConnectionStatus(connection, false);

  const { orgs, activeId } = useOrgs();
  const activeOrg = orgs.find((o) => o.id === activeId) ?? null;
  const accent = useActiveOrgAccent();
  const [orgOnline, setOrgOnline] = useState<boolean | null>(null);
  useEffect(() => {
    if (!activeOrg || !activeOrg.server_url) { setOrgOnline(null); return; }
    let cancelled = false;
    const ping = async () => {
      try {
        await fetchOrgHealth(activeOrg.server_url!);
        if (!cancelled) setOrgOnline(true);
      } catch {
        if (!cancelled) setOrgOnline(false);
      }
    };
    void ping();
    const iv = window.setInterval(ping, 60_000);
    return () => { cancelled = true; window.clearInterval(iv); };
  }, [activeOrg?.id, activeOrg?.server_url]);

  const retryHealth = async () => {
    if (!activeOrg?.server_url) return;
    try { await fetchOrgHealth(activeOrg.server_url); setOrgOnline(true); }
    catch { setOrgOnline(false); }
  };

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-border-subtle bg-surface px-3 text-[11px] text-text-muted">
      {activeOrg && (
        <span className="flex shrink-0 items-center gap-1.5" title={activeOrg.server_url ?? activeOrg.server_kind}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
          <span className="font-medium text-text">{activeOrg.name}</span>
          <span className="text-text-faint">·</span>
        </span>
      )}
      {connection ? (
        <span className="flex items-center gap-1.5">
          {status === "ok" ? (
            <Wifi strokeWidth={1.5} className="h-3 w-3 text-success" />
          ) : status === "fail" ? (
            <WifiOff strokeWidth={1.5} className="h-3 w-3 text-danger" />
          ) : (
            <Wifi strokeWidth={1.5} className="h-3 w-3 text-text-faint" />
          )}
          <span className="font-medium text-text">{connection.name}</span>
          <span className="text-text-faint">·</span>
          <Database strokeWidth={1.5} className="h-3 w-3" />
          <span>{connection.plugin_id}</span>
        </span>
      ) : (
        <span className="text-text-faint">{t("sidebar.noConnection")}</span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {orgOnline === false && (
          <button
            type="button"
            onClick={retryHealth}
            className="flex items-center gap-1.5 rounded-sm bg-warning/15 px-2 py-0.5 text-warning hover:bg-warning/25"
            title="Servidor de la organización inaccesible. Click para reintentar."
          >
            <CloudOff strokeWidth={1.5} className="h-3 w-3" />
            <span className="text-[10px] font-medium">Sin conexión</span>
          </button>
        )}
        <button
          type="button"
          onClick={onCommand}
          className="text-[10px] text-text-faint transition-colors hover:text-text"
        >
          {mod}K
        </button>
      </div>
    </footer>
  );
}
