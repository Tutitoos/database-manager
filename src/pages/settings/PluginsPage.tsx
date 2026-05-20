import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  CloudDownload,
  Loader2,
  Plug,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { pushToast } from "@/components/ui/toast";
import { SettingsCard, SettingsRow } from "@/components/settings/SettingsCard";
import { ProviderIcon } from "@/lib/providers";
import { useDebounced } from "@/lib/use-debounce";
import type { PluginInfo } from "@/lib/types";
import { useOrgs } from "@/store/orgs";
import { cn } from "@/lib/utils";

interface RemotePluginManifest {
  id: string;
  name: string;
  version: string;
  checksum_sha256?: string | null;
  download_url?: string | null;
  platforms?: string[];
  signature_b64?: string | null;
  signature_valid?: boolean | null;
}

export default function PluginsPage() {
  const { t } = useTranslation();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"installed" | "sync">("installed");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<RemotePluginManifest[]>([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const { orgs, activeId } = useOrgs();
  const activeOrg = orgs.find((o) => o.id === activeId) ?? null;

  async function refresh() {
    const next = await invoke<PluginInfo[]>("list_plugins").catch(() => []);
    setPlugins(next);
  }

  useEffect(() => {
    refresh().catch(console.error);
  }, []);

  useEffect(() => {
    if (selectedId == null && plugins.length > 0) setSelectedId(plugins[0].id);
  }, [plugins, selectedId]);

  async function rescanPlugins() {
    setBusy(true);
    try {
      await invoke("rescan_plugins");
      await refresh();
      pushToast({ level: "success", title: t("plugins.toasts.rescanOk") });
    } finally {
      setBusy(false);
    }
  }

  async function togglePlugin(plugin: PluginInfo, value: boolean) {
    try {
      await invoke(value ? "enable_plugin" : "disable_plugin", { pluginId: plugin.id });
      await refresh();
      pushToast({ level: "success", title: value ? t("plugins.toasts.enabled") : t("plugins.toasts.disabled") });
    } catch {
      await refresh();
    }
  }

  async function reload(plugin: PluginInfo) {
    try {
      await invoke("disable_plugin", { pluginId: plugin.id });
      await invoke("enable_plugin", { pluginId: plugin.id });
      await refresh();
      pushToast({ level: "success", title: t("plugins.toasts.reloadOk") });
    } catch (e) {
      pushToast({ level: "danger", title: String(e) });
    }
  }

  async function fetchRemote() {
    if (!activeOrg || activeOrg.server_kind === "local") return;
    setRemoteBusy(true);
    try {
      const list = await invoke<RemotePluginManifest[]>("sync_org_plugins", { orgId: activeOrg.id });
      setRemote(list);
      pushToast({ level: "success", title: t("plugins.toasts.syncOk") });
    } catch (e) {
      pushToast({ level: "danger", title: t("plugins.toasts.syncFail"), body: String(e) });
    } finally {
      setRemoteBusy(false);
    }
  }

  useEffect(() => {
    if (tab === "sync" && remote.length === 0 && activeOrg && activeOrg.server_kind !== "local") {
      void fetchRemote();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, activeOrg?.id]);

  const debouncedQuery = useDebounced(query, 180);
  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return plugins;
    return plugins.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q),
    );
  }, [plugins, debouncedQuery]);

  const selected = useMemo(() => plugins.find((p) => p.id === selectedId) ?? null, [plugins, selectedId]);
  const enabledCount = plugins.filter((p) => p.enabled).length;

  // Plugin runtime mode: client (default) vs server-side proxy. Persisted as
  // `app.plugins_server_mode` boolean in app_settings. Backend reads this to
  // route DB ops either to the local subprocess or via `/api/plugins_exec/...`.
  const [serverMode, setServerMode] = useState(false);
  useEffect(() => {
    invoke<string | null>("get_app_setting", { key: "app.plugins_server_mode" })
      .then((raw) => setServerMode(raw === "true" || raw === "\"true\""))
      .catch(() => undefined);
  }, []);
  async function toggleServerMode(v: boolean) {
    setServerMode(v);
    try {
      await invoke("set_app_setting", { key: "app.plugins_server_mode", valueJson: JSON.stringify(v) });
      pushToast({ level: "success", title: v ? t("plugins.runtime.toastOn") : t("plugins.runtime.toastOff") });
    } catch (e) {
      pushToast({ level: "danger", title: String(e) });
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-12">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg border border-border-subtle bg-surface-elevated text-text">
            <Plug strokeWidth={1.5} className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-h1 text-text">{t("plugins.title")}</h1>
            <p className="text-caption text-text-muted">{t("plugins.subtitle")}</p>
          </div>
        </div>
        <Button onClick={rescanPlugins} disabled={busy} size="sm" variant="secondary">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t("plugins.rescan")}
        </Button>
      </header>

      {/* Metrics */}
      <div className="grid grid-cols-3 divide-x divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface-elevated">
        <MetricCell label={t("plugins.metrics.installed")} value={plugins.length} />
        <MetricCell label={t("plugins.metrics.enabled")} value={enabledCount} />
        <MetricCell label={t("plugins.metrics.synced")} value={remote.length} />
      </div>

      {/* Runtime mode toggle */}
      <SettingsCard title={t("plugins.runtime.title")} description={t("plugins.runtime.description")}>
        <SettingsRow
          label={t("plugins.runtime.label")}
          description={
            serverMode
              ? t("plugins.runtime.serverHint")
              : t("plugins.runtime.clientHint")
          }
          control={<Switch checked={serverMode} onCheckedChange={toggleServerMode} />}
        />
      </SettingsCard>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 border-b border-border-subtle">
        <TabBtn active={tab === "installed"} onClick={() => setTab("installed")}>
          <Plug className="h-3.5 w-3.5" /> {t("plugins.tabs.installed")}
        </TabBtn>
        <TabBtn active={tab === "sync"} onClick={() => setTab("sync")}>
          <CloudDownload className="h-3.5 w-3.5" /> {t("plugins.tabs.sync")}
        </TabBtn>
      </div>

      {tab === "installed" && (
        <InstalledView
          plugins={filtered}
          selected={selected}
          selectedId={selectedId}
          query={query}
          setQuery={setQuery}
          onSelect={setSelectedId}
          onToggle={togglePlugin}
          onReload={reload}
        />
      )}

      {tab === "sync" && (
        <SyncView
          remote={remote}
          installed={plugins}
          busy={remoteBusy}
          activeOrg={activeOrg}
          onRefetch={fetchRemote}
        />
      )}
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-4">
      <div className="text-metric font-semibold tracking-[-.02em] text-text">{value}</div>
      <div className="text-caption mt-1 text-text-muted">{label}</div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-body inline-flex items-center gap-1.5 border-b-2 px-3 py-2 font-medium transition-colors",
        active ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

function InstalledView({
  plugins,
  selected,
  selectedId,
  query,
  setQuery,
  onSelect,
  onToggle,
  onReload,
}: {
  plugins: PluginInfo[];
  selected: PluginInfo | null;
  selectedId: string | null;
  query: string;
  setQuery: (v: string) => void;
  onSelect: (id: string) => void;
  onToggle: (p: PluginInfo, v: boolean) => Promise<void>;
  onReload: (p: PluginInfo) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-text-faint" />
        <Input
          className="h-8 pl-8 text-body"
          placeholder={t("plugins.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-5">
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-elevated">
            {plugins.length === 0 && (
              <p className="text-body p-4 text-text-muted">
                {query ? t("plugins.noMatches", { query }) : t("plugins.empty")}
              </p>
            )}
            {plugins.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect(p.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 border-b border-border-subtle px-3 py-2.5 text-left transition-colors last:border-b-0",
                  selectedId === p.id ? "bg-accent-soft" : "hover:bg-surface-hover",
                )}
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-md border border-border-subtle bg-surface">
                  <ProviderIcon providerId={p.id} className="block h-full w-full object-cover" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body truncate font-medium text-text">{p.name}</p>
                  <p className="text-caption truncate text-text-muted">v{p.version}</p>
                </div>
                <StatusDot loaded={p.loaded} enabled={p.enabled} />
              </button>
            ))}
          </div>
        </div>

        <div className="col-span-7">
          {!selected ? (
            <div className="grid h-48 place-items-center rounded-lg border border-dashed border-border-subtle text-caption text-text-muted">
              {t("plugins.select")}
            </div>
          ) : (
            <PluginDetail plugin={selected} onToggle={onToggle} onReload={onReload} />
          )}
        </div>
      </div>
    </>
  );
}

function StatusDot({ loaded, enabled }: { loaded: boolean; enabled: boolean }) {
  if (!enabled) return <span className="h-1.5 w-1.5 rounded-full bg-text-faint" />;
  if (loaded) return <span className="h-1.5 w-1.5 rounded-full bg-success" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-warn" />;
}

function PluginDetail({
  plugin,
  onToggle,
  onReload,
}: {
  plugin: PluginInfo;
  onToggle: (p: PluginInfo, v: boolean) => Promise<void>;
  onReload: (p: PluginInfo) => Promise<void>;
}) {
  const { t } = useTranslation();
  const caps = Object.entries(plugin.manifest.capabilities ?? {});
  const settings = plugin.manifest.settings ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-elevated p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md border border-border-subtle bg-surface">
          <ProviderIcon providerId={plugin.id} className="block h-full w-full object-cover" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-h1 truncate text-text">{plugin.name}</h2>
          <p className="text-caption truncate text-text-muted">
            v{plugin.version} · {plugin.builtin ? t("plugins.detail.builtin") : t("plugins.detail.third")}
          </p>
        </div>
        <Switch checked={plugin.enabled} onCheckedChange={(v) => onToggle(plugin, v)} />
      </div>

      <SettingsCard title="">
        <SettingsRow label={t("plugins.detail.status")} control={
          <span className="text-caption inline-flex items-center gap-1">
            {plugin.enabled ? (
              plugin.loaded ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" /> {t("plugins.detail.loaded")}
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3.5 w-3.5 text-warn" /> {t("plugins.detail.notLoaded")}
                </>
              )
            ) : (
              <>
                <XCircle className="h-3.5 w-3.5 text-text-faint" /> {t("plugins.detail.disabled")}
              </>
            )}
          </span>
        } />
        <SettingsRow label={t("plugins.detail.version")} control={<span className="text-body text-text">v{plugin.version}</span>} />
        <SettingsRow label={t("plugins.detail.path")} control={
          <code className="text-body-mono max-w-[20rem] truncate text-text-muted" title={plugin.path}>{plugin.path}</code>
        } />
      </SettingsCard>

      {plugin.description && (
        <p className="text-body text-text-muted">{plugin.description}</p>
      )}

      {plugin.error && (
        <div className="rounded-md border border-danger/40 bg-danger-soft p-3 text-body text-danger">
          <div className="flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5" /> {t("plugins.detail.error")}</div>
          <p className="mt-1 font-mono text-body-mono">{plugin.error}</p>
          {plugin.error.includes("EOF") && (
            <p className="text-caption mt-1 text-danger/80">{t("plugins.detail.errorHint")}</p>
          )}
        </div>
      )}

      <SettingsCard title={t("plugins.detail.capabilities")}>
        {caps.length === 0 ? (
          <p className="text-body p-3 text-text-muted">{t("plugins.detail.noCapabilities")}</p>
        ) : (
          caps.map(([k, v]) => (
            <SettingsRow
              key={k}
              label={k}
              control={<code className="text-body-mono text-text-muted">{String(v)}</code>}
            />
          ))
        )}
      </SettingsCard>

      <SettingsCard title={t("plugins.detail.settings")}>
        {settings.length === 0 ? (
          <p className="text-body p-3 text-text-muted">{t("plugins.detail.noSettings")}</p>
        ) : (
          settings.map((s) => (
            <SettingsRow
              key={s.key}
              label={s.label || s.key}
              description={s.type + (s.required ? " · required" : "")}
              control={<code className="text-body-mono text-text-muted">{String(s.default ?? "")}</code>}
            />
          ))
        )}
      </SettingsCard>

      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => onReload(plugin)}>
          <RefreshCw className="h-3.5 w-3.5" /> {t("plugins.detail.reload")}
        </Button>
        <Button
          variant={plugin.enabled ? "ghost" : "primary"}
          size="sm"
          onClick={() => onToggle(plugin, !plugin.enabled)}
        >
          {plugin.enabled ? t("plugins.detail.disable") : t("plugins.detail.enable")}
        </Button>
      </div>
    </div>
  );
}

function SyncView({
  remote,
  installed,
  busy,
  activeOrg,
  onRefetch,
}: {
  remote: RemotePluginManifest[];
  installed: PluginInfo[];
  busy: boolean;
  activeOrg: ReturnType<typeof useOrgs>["orgs"][number] | null;
  onRefetch: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const installedIds = useMemo(() => new Set(installed.map((p) => p.id)), [installed]);
  const [installing, setInstalling] = useState<string | null>(null);

  async function handleInstall(p: RemotePluginManifest) {
    if (!activeOrg) return;
    setInstalling(p.id);
    try {
      await invoke("install_org_plugin", { orgId: activeOrg.id, pluginId: p.id });
      pushToast({ level: "success", title: t("plugins.toasts.installOk", { name: p.name }) });
      await onRefetch();
    } catch (e) {
      pushToast({ level: "danger", title: t("plugins.toasts.installFail"), body: String(e) });
    } finally {
      setInstalling(null);
    }
  }

  if (!activeOrg || activeOrg.server_kind === "local") {
    return (
      <div className="rounded-lg border border-border-subtle bg-surface-elevated p-6 text-center text-body text-text-muted">
        <Boxes className="mx-auto mb-2 h-5 w-5 text-text-faint" />
        {t("plugins.sync.noOrg")}
      </div>
    );
  }

  return (
    <SettingsCard title={t("plugins.sync.title")} description={t("plugins.sync.subtitle")}>
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2">
        <span className="text-caption text-text-muted">{activeOrg.name} · {activeOrg.server_url}</span>
        <Button size="sm" variant="secondary" onClick={onRefetch} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t("plugins.sync.fetch")}
        </Button>
      </div>
      {remote.length === 0 ? (
        <p className="text-body p-4 text-text-muted">{t("plugins.sync.empty")}</p>
      ) : (
        remote.map((p) => (
          <SettingsRow
            key={p.id}
            label={
              <span className="inline-flex items-center gap-1.5">
                {p.name}
                {p.signature_valid === true && (
                  <span title={t("plugins.signatureVerified")} className="inline-flex items-center gap-0.5 rounded-sm bg-success-soft px-1 text-tiny text-success">
                    <CheckCircle2 className="h-2.5 w-2.5" /> sig
                  </span>
                )}
                {p.signature_valid === false && (
                  <span title={t("plugins.signatureInvalid")} className="inline-flex items-center gap-0.5 rounded-sm bg-danger-soft px-1 text-tiny text-danger">
                    <AlertTriangle className="h-2.5 w-2.5" /> sig!
                  </span>
                )}
              </span>
            }
            description={`${t("plugins.sync.remoteVersion", { version: p.version })}${
              p.checksum_sha256 ? ` · ${t("plugins.sync.checksum")}: ${p.checksum_sha256.slice(0, 12)}…` : ""
            }`}
            control={
              installedIds.has(p.id) ? (
                <span className="text-caption inline-flex items-center gap-1 rounded-md bg-success-soft px-2 py-0.5 text-success">
                  <CheckCircle2 className="h-3 w-3" /> {t("plugins.detail.enabled")}
                </span>
              ) : p.signature_valid === true ? (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => handleInstall(p)}
                  disabled={installing !== null}
                >
                  {installing === p.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <CloudDownload className="h-3 w-3" />
                  )}
                  {t("plugins.sync.install")}
                </Button>
              ) : (
                <span className="text-caption inline-flex items-center gap-1 rounded-md bg-warn-soft px-2 py-0.5 text-warn">
                  <AlertTriangle className="h-3 w-3" /> {t("plugins.sync.unsigned")}
                </span>
              )
            }
          />
        ))
      )}
    </SettingsCard>
  );
}
