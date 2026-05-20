import { invoke } from "@tauri-apps/api/core";
import {
  ArrowRight,
  Boxes,
  Download,
  Folder,
  Plug,
  Plus,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@/lib/router-compat";
import { pushToast } from "@/components/ui/toast";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { PROVIDER_UI, ProviderIcon } from "@/lib/providers";
import { ping, useConnectionStatus, type ConnStatus } from "@/lib/connection-status";
import { useSessionsStore } from "@/store/sessions";
import { useOrgs } from "@/store/orgs";
import { useOpenConnection } from "@/components/connect-gate";
import type { Connection, ConnectionGroup } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { sessions } = useSessionsStore();
  const openConnection = useOpenConnection();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [groups, setGroups] = useState<ConnectionGroup[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { orgs, activeId } = useOrgs();
  const activeOrg = orgs.find((o) => o.id === activeId) ?? null;

  async function refresh() {
    const [conns, grps] = await Promise.all([
      invoke<Connection[]>("list_connections").catch(() => []),
      invoke<ConnectionGroup[]>("list_groups").catch(() => []),
    ]);
    setConnections(conns);
    setGroups(grps);
  }

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener("app:org-changed", onChange);
    return () => window.removeEventListener("app:org-changed", onChange);
  }, []);

  // Probe online count in background (best-effort).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let online = 0;
      for (const c of connections) {
        try {
          const ok = await ping(c);
          if (ok) online += 1;
        } catch { /* ignore */ }
        if (cancelled) return;
      }
      if (!cancelled) setOnlineCount(online);
    })();
    return () => { cancelled = true; };
  }, [connections]);

  const openCount = useMemo(() => Object.keys(sessions).length, [sessions]);


  async function handleExport() {
    const dump = {
      exported_at: new Date().toISOString(),
      org: activeOrg ? { id: activeOrg.id, name: activeOrg.name, server_kind: activeOrg.server_kind } : null,
      groups,
      connections: connections.map((c) => ({ ...c, password: "" })),
    };
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `database-manager-connections-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast({ level: "success", title: t("home.toasts.exported") });
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const parsed = JSON.parse(text) as { connections?: Connection[] };
      const list = parsed.connections ?? [];
      for (const c of list) {
        await invoke("create_connection", {
          input: {
            name: c.name,
            plugin_id: c.plugin_id,
            host: c.host,
            port: c.port,
            database: c.database,
            username: c.username,
            password: c.password ?? "",
            ssl_mode: c.ssl_mode,
            settings_json: c.settings_json,
            group_id: c.group_id ?? null,
            credential_id: c.credential_id ?? null,
          },
        });
      }
      await refresh();
      pushToast({ level: "success", title: t("home.toasts.imported"), body: String(list.length) });
    } catch (err) {
      pushToast({ level: "danger", title: t("home.toasts.importFailed"), body: String(err) });
    } finally {
      e.target.value = "";
    }
  }

  const providerCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of connections) map[c.plugin_id] = (map[c.plugin_id] ?? 0) + 1;
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [connections]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-8">
      <header>
        <h1 className="text-page-title text-text">{t("home.title")}</h1>
        <p className="text-caption mt-0.5 text-text-muted">{t("home.welcome")}</p>
      </header>

      {/* Stats */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <StatCard label={t("home.stats.total")} value={connections.length} icon={<Plug className="h-4 w-4" />} />
        <StatCard label={t("home.stats.open")} value={openCount} icon={<Boxes className="h-4 w-4" />} />
        <StatCard label={t("home.stats.online")} value={onlineCount} accent="success" icon={<ArrowRight className="h-4 w-4" />} />
        <ProvidersBreakdown counts={providerCounts} />
      </section>

      {/* Workspace activo */}
      <section className="rounded-lg border border-border-subtle bg-surface-elevated">
        <header className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Folder className="h-3.5 w-3.5 text-text-faint" strokeWidth={1.5} />
            <h2 className="text-h3 text-text">{t("home.workspace.title")}</h2>
          </div>
          <button
            type="button"
            onClick={() => navigate("/connections")}
            className="text-caption inline-flex items-center gap-1 text-text-muted hover:text-text"
          >
            {t("home.workspace.viewAll")} <ArrowRight className="h-3 w-3" />
          </button>
        </header>
        {connections.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-body text-text-muted">{t("home.workspace.empty")}</p>
            <Button variant="primary" size="sm" onClick={() => navigate("/connections")} className="mt-3">
              <Plus className="h-3.5 w-3.5" /> {t("home.quickActions.newConnection")}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
            {connections.slice(0, 12).map((c) => (
              <ConnectionCard key={c.id} connection={c} onOpen={() => openConnection(c)} sessions={sessions} />
            ))}
          </div>
        )}
      </section>

      {/* Acciones rápidas */}
      <section>
        <h2 className="text-overline mb-2">{t("home.quickActions.title")}</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <QuickAction
            icon={<Plus className="h-4 w-4" />}
            title={t("home.quickActions.newConnection")}
            description={t("home.quickActions.newConnectionDescription")}
            onClick={() => navigate("/connections")}
            accent
          />
          <QuickAction
            icon={<Upload className="h-4 w-4" />}
            title={t("home.quickActions.import")}
            description={t("home.quickActions.importDescription")}
            onClick={() => fileInputRef.current?.click()}
          />
          <QuickAction
            icon={<Download className="h-4 w-4" />}
            title={t("home.quickActions.export")}
            description={t("home.quickActions.exportDescription")}
            onClick={handleExport}
          />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={handleImportFile}
        />
      </section>

    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent?: "success" | "info";
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-elevated p-4">
      <div className="flex items-center justify-between">
        <span className="text-overline">{label}</span>
        <span className={cn(
          "grid h-6 w-6 place-items-center rounded-md",
          accent === "success" ? "bg-success-soft text-success" : "bg-surface-sunken text-text-faint",
        )}>
          {icon}
        </span>
      </div>
      <p className="text-metric mt-2 text-text">{value}</p>
    </div>
  );
}

function ProvidersBreakdown({ counts }: { counts: [string, number][] }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-elevated p-4">
      <span className="text-overline">{t("home.stats.byProvider")}</span>
      <div className="mt-2 flex flex-col gap-1.5">
        {counts.length === 0 && <span className="text-caption text-text-faint">—</span>}
        {counts.map(([pid, n]) => {
          const ui = PROVIDER_UI[pid];
          return (
            <div key={pid} className="flex items-center gap-2">
              <span className="grid h-4 w-4 shrink-0 place-items-center overflow-hidden rounded-sm">
                <ProviderIcon providerId={pid} className="block h-full w-full object-cover" />
              </span>
              <span className="text-body flex-1 truncate text-text">{ui?.name ?? pid}</span>
              <span className="text-caption font-medium text-text-muted">{n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConnectionCard({
  connection,
  onOpen,
  sessions,
}: {
  connection: Connection;
  onOpen: () => void;
  sessions: Record<number, unknown>;
}) {
  const status = useConnectionStatus(connection, true);
  const ui = PROVIDER_UI[connection.plugin_id];
  const port = connection.port ? `:${connection.port}` : "";
  const isOpen = Boolean(sessions[connection.id]);
  return (
    <button
      type="button"
      onMouseEnter={() => void ping(connection)}
      onFocus={() => void ping(connection)}
      onClick={onOpen}
      className="group relative flex flex-col gap-3 overflow-hidden rounded-lg border border-border-subtle bg-surface p-3.5 text-left transition-colors hover:border-border-strong hover:bg-surface-elevated"
    >
      <span
        className="absolute left-0 top-2 h-[calc(100%-16px)] w-0.5 rounded-r"
        style={{ background: ui?.color ?? "var(--accent)" }}
        aria-hidden
      />
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 shrink-0 overflow-hidden rounded-md border border-border-subtle bg-surface">
          <ProviderIcon providerId={connection.plugin_id} className="block h-full w-full object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-h3 truncate font-medium text-text">{connection.name}</p>
          <p className="text-body-mono truncate text-text-muted">
            {connection.host}
            {port}
          </p>
        </div>
        <ArrowRight
          strokeWidth={1.5}
          className="h-3.5 w-3.5 shrink-0 text-text-faint transition-transform group-hover:translate-x-0.5"
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-tiny uppercase tracking-wider text-text-faint">{ui?.name ?? connection.plugin_id}</span>
        <div className="flex items-center gap-1.5">
          {isOpen && <StatusPill variant="info">·</StatusPill>}
          <StatusBadge status={status} />
        </div>
      </div>
    </button>
  );
}

function StatusBadge({ status }: { status: ConnStatus }) {
  if (status === "ok") return <StatusPill variant="success">●</StatusPill>;
  if (status === "fail") return <StatusPill variant="danger">●</StatusPill>;
  if (status === "checking") return <StatusPill variant="info">…</StatusPill>;
  return <StatusPill variant="neutral">—</StatusPill>;
}

function QuickAction({
  icon,
  title,
  description,
  onClick,
  shortcut,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  shortcut?: string;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex items-start gap-3 rounded-lg border border-border-subtle bg-surface-elevated p-3.5 text-left transition-colors",
        "hover:border-border-strong hover:bg-surface-hover",
      )}
    >
      <div className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border-subtle",
        accent ? "bg-accent-soft text-accent" : "bg-surface text-text-muted",
      )}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-text">{title}</p>
        <p className="text-caption mt-0.5 truncate text-text-muted">{description}</p>
      </div>
      {shortcut && (
        <kbd className="text-tiny absolute right-2 top-2 rounded border border-border-subtle bg-surface-sunken px-1.5 py-0.5 font-mono text-text-faint">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}
