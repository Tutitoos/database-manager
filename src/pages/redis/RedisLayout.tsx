import { invoke } from "@tauri-apps/api/core";
import { Activity, Pin, Radio, Trash2, X } from "lucide-react";
import { useNavigate, useSearchParams } from "@/lib/router-compat";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MetricsPanel } from "@/components/metrics-panel-lazy";
import RedisChannelView from "./RedisPubSubPage";
import { RedisKeyView } from "./RedisPage";
import { RedisKeyNavigator } from "./redis-navigator";
import { WorkspaceTabsStrip, WorkspaceTabContextMenu, WorkspaceMenuItem } from "@/components/workspace/WorkspaceTabsStrip";
import { WelcomeScreen, type WelcomeAction } from "@/components/workspace/WelcomeScreen";
import { ConnHeaderLeft, NewTabButton } from "@/components/workspace/LayoutChrome";
import { getProviderUi } from "@/lib/providers";
import { panel } from "@/lib/styles";
import type { Connection, RedisKey } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  useSessionsStore,
  type EntityTab,
  type ChannelTab,
  type ViewTab,
  type RedisSession,
  type WorkspaceTab,
} from "@/store/sessions";
import { PageHeader } from "@/components/ui/page-header";
import { useInspectorContextFor } from "@/components/shell/InspectorContext";

export default function RedisLayout() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const connectionId = Number(searchParams.get("id"));

  const { sessions, updateSession, openTab, closeTab, pinTab, setActiveTab, reorderTabs } = useSessionsStore();
  const stored = sessions[connectionId] as RedisSession | undefined;

  const [connection, setConnection] = useState<Connection | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  const [keys, setKeys] = useState<RedisKey[]>([]);
  const [loadingDbs, setLoadingDbs] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [newTabMenu, setNewTabMenu] = useState<{ x: number; y: number } | null>(null);
  const [channelDraft, setChannelDraft] = useState<string | null>(null);

  // ── Local UI state (search, type filter, view mode) — persisted via store
  const keySearch = stored?.keySearch ?? "";
  const typeFilter = stored?.typeFilter ?? "all";
  const viewMode = stored?.viewMode ?? "tree";
  const activeDb = stored?.activeDb || "0";

  const setKeySearch = useCallback(
    (v: string) => updateSession(connectionId, { keySearch: v }),
    [connectionId, updateSession],
  );
  const setTypeFilter = useCallback(
    (v: string) => updateSession(connectionId, { typeFilter: v }),
    [connectionId, updateSession],
  );
  const setViewMode = useCallback(
    (v: "list" | "tree") => updateSession(connectionId, { viewMode: v }),
    [connectionId, updateSession],
  );
  const setActiveDb = useCallback(
    (db: string) => updateSession(connectionId, { activeDb: db }),
    [connectionId, updateSession],
  );

  // ── Load connection + databases
  useEffect(() => {
    invoke<Connection[]>("list_connections").then((all) => {
      setConnection(all.find((c) => c.id === connectionId) ?? null);
    });
  }, [connectionId]);

  useEffect(() => {
    if (!connection) return;
    setLoadingDbs(true);
    invoke<string[]>("list_databases", { input: connection })
      .then(setDatabases)
      .catch(() => setDatabases([]))
      .finally(() => setLoadingDbs(false));
  }, [connection]);

  const reloadKeys = useCallback(() => {
    if (!connection) return;
    setLoadingKeys(true);
    setKeys([]);
    invoke<RedisKey[]>("list_redis_keys", { input: connection, database: activeDb })
      .then(setKeys)
      .catch(() => setKeys([]))
      .finally(() => setLoadingKeys(false));
  }, [connection, activeDb]);

  useEffect(() => { reloadKeys(); }, [reloadKeys]);

  // ── Active tab from store
  const activeTab: WorkspaceTab | undefined = useMemo(() => {
    if (!stored || !stored.activeTabId) return undefined;
    return stored.openTabs.find((t) => t.id === stored.activeTabId);
  }, [stored]);

  const activeKeyName = activeTab?.kind === "entity" ? activeTab.name : "";

  // ── Tab actions
  const openKeyTab = useCallback(
    (key: string, opts: { ephemeral: boolean } = { ephemeral: true }) => {
      openTab(
        connectionId,
        {
          kind: "entity",
          entityKind: "key",
          db: activeDb,
          name: key,
          title: key,
        } as Omit<EntityTab, "id" | "ephemeral" | "pinned" | "createdAt">,
        opts,
      );
    },
    [connectionId, activeDb, openTab],
  );

  const openChannelTab = useCallback(
    (channel: string) => {
      openTab(
        connectionId,
        {
          kind: "channel",
          channel,
          title: channel,
        } as Omit<ChannelTab, "id" | "ephemeral" | "pinned" | "createdAt">,
        { ephemeral: false },
      );
    },
    [connectionId, openTab],
  );

  const openMetricsTab = useCallback(() => {
    openTab(
      connectionId,
      {
        kind: "view",
        view: "metrics",
        title: "Metrics",
      } as Omit<ViewTab, "id" | "ephemeral" | "pinned" | "createdAt">,
      { ephemeral: false },
    );
  }, [connectionId, openTab]);

  function onWelcomeAction(action: WelcomeAction) {
    if (action.kind === "open-metrics") return openMetricsTab();
    if (action.kind === "subscribe-channel") setChannelDraft("");
  }

  function onWelcomeRecent(tab: WorkspaceTab) {
    if (tab.kind === "entity") openKeyTab(tab.name, { ephemeral: false });
    else if (tab.kind === "channel") openChannelTab(tab.channel);
    else if (tab.kind === "view") openMetricsTab();
  }

  function submitChannel() {
    const ch = (channelDraft ?? "").trim();
    setChannelDraft(null);
    if (ch) openChannelTab(ch);
  }

  const provider = connection ? getProviderUi(connection.plugin_id) : null;

  useInspectorContextFor({
    connection,
    database: activeDb ? `DB ${activeDb}` : null,
    table: activeKeyName || null,
    tableLabel: "Key",
    extras: keys.length > 0
      ? [{ label: "Keys", value: <span className="text-text-muted">{keys.length}</span> }]
      : undefined,
  });

  // ── Session guard
  const missingSession = !!connectionId && !sessions[connectionId];
  useEffect(() => {
    if (missingSession) navigate("/connections", { replace: true });
  }, [missingSession, navigate]);
  if (missingSession) return null;

  // ── Render
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col", panel)}>
      <PageHeader left={<ConnHeaderLeft connection={connection} />} />

      <WorkspaceTabsStrip
        items={stored?.openTabs ?? []}
        activeId={stored?.activeTabId ?? null}
        onSelect={(id) => setActiveTab(connectionId, id)}
        onClose={(id) => closeTab(connectionId, id)}
        onPin={(id) => pinTab(connectionId, id)}
        onReorder={(ids) => reorderTabs(connectionId, ids)}
        onContext={(id, x, y) => setCtxMenu({ id, x, y })}
        trailing={<NewTabButton onClick={(e) => setNewTabMenu({ x: e.clientX, y: e.clientY })} />}
      />

      <div className="flex min-h-0 flex-1">
        <RedisKeyNavigator
          keys={keys}
          loading={loadingKeys}
          search={keySearch}
          onSearchChange={setKeySearch}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          databases={databases}
          activeDb={activeDb}
          onDbChange={setActiveDb}
          loadingDbs={loadingDbs}
          onReload={reloadKeys}
          onSelectKey={(k) => openKeyTab(k, { ephemeral: true })}
          onPinKey={(k) => openKeyTab(k, { ephemeral: false })}
          activeKey={activeKeyName}
          providerColor={provider?.color}
        />

        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {!stored || !activeTab ? (
            stored ? (
              <WelcomeScreen
                session={stored}
                onAction={onWelcomeAction}
                onOpenRecent={onWelcomeRecent}
              />
            ) : null
          ) : connection ? (
            renderTabContent(activeTab, connection, activeDb, stored)
          ) : null}
        </div>
      </div>

      {ctxMenu && (
        <WorkspaceTabContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)}>
          <WorkspaceMenuItem
            icon={<Pin className="h-3 w-3 -rotate-45 text-accent/80" />}
            label="Anclar pestaña"
            onClick={() => { pinTab(connectionId, ctxMenu.id); setCtxMenu(null); }}
          />
          <WorkspaceMenuItem
            icon={<X className="h-3 w-3" />}
            label="Cerrar"
            shortcut="⌘W"
            onClick={() => { closeTab(connectionId, ctxMenu.id); setCtxMenu(null); }}
          />
          <WorkspaceMenuItem
            icon={<Trash2 className="h-3 w-3" />}
            label="Cerrar las demás"
            onClick={() => {
              const ids = (stored?.openTabs ?? []).map((t) => t.id).filter((id) => id !== ctxMenu.id);
              for (const id of ids) closeTab(connectionId, id);
              setCtxMenu(null);
            }}
            danger
          />
        </WorkspaceTabContextMenu>
      )}

      {newTabMenu && (
        <WorkspaceTabContextMenu x={newTabMenu.x} y={newTabMenu.y} onClose={() => setNewTabMenu(null)}>
          <WorkspaceMenuItem
            icon={<Radio className="h-3 w-3 text-pink-400" />}
            label="Suscribir canal"
            onClick={() => { setNewTabMenu(null); setChannelDraft(""); }}
          />
          <WorkspaceMenuItem
            icon={<Activity className="h-3 w-3 text-sky-400" />}
            label="Abrir métricas"
            onClick={() => { setNewTabMenu(null); openMetricsTab(); }}
          />
        </WorkspaceTabContextMenu>
      )}

      {channelDraft !== null && (
        <div
          onClick={() => setChannelDraft(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-md border border-border-subtle bg-surface p-5 shadow-xl"
          >
            <h2 className="text-h3 font-medium text-text">Suscribir a canal</h2>
            <input
              autoFocus
              value={channelDraft}
              onChange={(e) => setChannelDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitChannel(); }}
              placeholder="canal o patrón"
              className="mt-3 h-9 w-full rounded-md border border-border-strong bg-[#0a0a0a] px-3 text-h3 text-text outline-none"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setChannelDraft(null)}
                className="rounded border border-border-strong px-3 py-1.5 text-body text-text hover:bg-surface-hover"
              >
                Cancelar
              </button>
              <button
                onClick={submitChannel}
                className="rounded bg-blue-600 px-3 py-1.5 text-body font-medium text-text hover:bg-blue-500"
              >
                Suscribir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function renderTabContent(
  tab: WorkspaceTab,
  connection: Connection,
  activeDb: string,
  stored: RedisSession,
): React.ReactNode {
  if (tab.kind === "entity" && tab.entityKind === "key") {
    return (
      <RedisKeyView
        key={tab.id}
        connection={connection}
        database={tab.db || activeDb}
        redisKey={tab.name}
      />
    );
  }
  if (tab.kind === "channel") {
    return <RedisChannelView key={tab.id} connection={connection} channel={tab.channel} />;
  }
  if (tab.kind === "view" && tab.view === "metrics") {
    const channels = stored.openTabs
      .filter((t): t is ChannelTab => t.kind === "channel")
      .map((t) => t.channel);
    return (
      <div className="min-h-0 flex-1 overflow-hidden h-full">
        <MetricsPanel connection={connection} database={tab.db || activeDb} pubsubChannels={channels} />
      </div>
    );
  }
  return null;
}

