import { invoke } from "@tauri-apps/api/core";
import { Activity, ChevronDown, ChevronRight, Database, Loader2, Plus } from "lucide-react";
import { useNavigate, useSearchParams } from "@/lib/router-compat";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MetricsPanel } from "@/components/metrics-panel";
import DocumentPage from "@/pages/document/DocumentPage";
import { WorkspaceTabsStrip, WorkspaceTabContextMenu } from "@/components/workspace/WorkspaceTabsStrip";
import { WelcomeScreen, type WelcomeAction } from "@/components/workspace/WelcomeScreen";
import { getProviderUi, ProviderIcon, parseSettings } from "@/lib/providers";
import { panel } from "@/lib/styles";
import type { Connection } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  useSessionsStore,
  type EntityTab,
  type ViewTab,
  type DocumentSession,
  type WorkspaceTab,
} from "@/store/sessions";
import { PageHeader } from "@/components/ui/page-header";
import { useInspectorContextFor } from "@/components/shell/InspectorContext";

export default function DocumentLayout() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const connectionId = Number(searchParams.get("id"));

  const { sessions, updateSession, openTab, closeTab, pinTab, setActiveTab, reorderTabs } = useSessionsStore();
  const stored = sessions[connectionId] as DocumentSession | undefined;

  const [connection, setConnection] = useState<Connection | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  const [collectionsPerDb, setCollectionsPerDb] = useState<Record<string, string[]>>({});
  const [loadingCollections, setLoadingCollections] = useState<Record<string, boolean>>({});
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(() => new Set(stored?.expandedDbs ?? []));
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [newTabMenu, setNewTabMenu] = useState<{ x: number; y: number } | null>(null);
  const [navCollapsed, setNavCollapsed] = useState(false);

  const provider = connection ? getProviderUi(connection.plugin_id) : null;

  useEffect(() => {
    invoke<Connection[]>("list_connections").then((all) => {
      setConnection(all.find((c) => c.id === connectionId) ?? null);
    });
  }, [connectionId]);

  useEffect(() => {
    if (!connection) return;
    invoke<string[]>("list_databases", { input: connection })
      .then((all) => {
        const settings = parseSettings(connection.settings_json);
        const selected = Array.isArray(settings.selectedDatabases) ? (settings.selectedDatabases as string[]) : [];
        const dbs = selected.length > 0 ? all.filter((db) => selected.includes(db)) : all;
        setDatabases(dbs);
        if (dbs.length > 0 && expandedDbs.size === 0) {
          setExpandedDbs(new Set([dbs[0]]));
        }
      })
      .catch(() => setDatabases([]));
  }, [connection]);

  const loadCollections = useCallback((db: string) => {
    if (!connection || collectionsPerDb[db] || loadingCollections[db]) return;
    setLoadingCollections((prev) => ({ ...prev, [db]: true }));
    invoke<string[]>("list_collections", { input: connection, database: db })
      .then((rows) => setCollectionsPerDb((prev) => ({ ...prev, [db]: rows })))
      .catch(() => undefined)
      .finally(() => setLoadingCollections((prev) => ({ ...prev, [db]: false })));
  }, [connection, collectionsPerDb, loadingCollections]);

  useEffect(() => {
    for (const db of expandedDbs) loadCollections(db);
  }, [expandedDbs, loadCollections]);

  function toggleDb(db: string) {
    setExpandedDbs((prev) => {
      const next = new Set(prev);
      if (next.has(db)) next.delete(db);
      else next.add(db);
      updateSession(connectionId, { expandedDbs: [...next] });
      return next;
    });
  }

  const activeTab: WorkspaceTab | undefined = useMemo(() => {
    if (!stored || !stored.activeTabId) return undefined;
    return stored.openTabs.find((t) => t.id === stored.activeTabId);
  }, [stored]);

  // URL sync.
  useEffect(() => {
    if (!connectionId || !activeTab) return;
    let url = `/connections/document?id=${connectionId}`;
    if (activeTab.kind === "entity") {
      url += `&db=${encodeURIComponent(activeTab.db)}&collection=${encodeURIComponent(activeTab.name)}`;
    } else if (activeTab.kind === "view" && activeTab.view === "metrics") {
      const db = activeTab.db || stored?.activeDb || databases[0] || "";
      url += `&db=${encodeURIComponent(db)}&view=metrics`;
    }
    navigate(url, { replace: true });
    const patch: Partial<DocumentSession> = {};
    if (activeTab.kind === "entity") {
      patch.activeDb = activeTab.db;
      patch.activeCollection = activeTab.name;
      patch.activeView = "";
    } else if (activeTab.kind === "view") {
      patch.activeView = activeTab.view;
    }
    updateSession(connectionId, patch);
  }, [activeTab?.id]);

  const openCollectionTab = useCallback(
    (db: string, collection: string, opts: { ephemeral: boolean } = { ephemeral: true }) => {
      openTab(
        connectionId,
        {
          kind: "entity",
          entityKind: "collection",
          db,
          name: collection,
          title: collection,
        } as Omit<EntityTab, "id" | "ephemeral" | "pinned" | "createdAt">,
        opts,
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
  }

  function onWelcomeRecent(tab: WorkspaceTab) {
    if (tab.kind === "entity") openCollectionTab(tab.db, tab.name, { ephemeral: false });
    else if (tab.kind === "view") openMetricsTab();
  }

  const activeEntityKey = activeTab?.kind === "entity" ? `${activeTab.db}/${activeTab.name}` : null;
  const activeDb = activeTab?.kind === "entity" ? activeTab.db : (stored?.activeDb || databases[0] || "");

  useInspectorContextFor({
    connection,
    database: activeDb || null,
    table: activeTab?.kind === "entity" ? activeTab.name : null,
    tableLabel: "Collection",
    extras: databases.length > 0
      ? [{ label: "Databases", value: <span className="text-text-muted">{databases.length}</span> }]
      : undefined,
  });

  const missingSession = !!connectionId && !sessions[connectionId];
  useEffect(() => {
    if (missingSession) navigate("/connections", { replace: true });
  }, [missingSession, navigate]);
  if (missingSession) return null;

  return (
    <div className={cn("flex min-w-0 flex-1 flex-col", panel)}>
      <PageHeader
        left={
          connection && provider ? (
            <div className="flex items-center gap-2">
              <span className="shrink-0 h-5 w-5 overflow-hidden rounded-sm border border-border-subtle">
                <ProviderIcon providerId={connection.plugin_id} className="block h-full w-full object-cover" />
              </span>
              <span className="text-h3 font-medium text-text">{connection.name}</span>
              <span className="text-body text-text-muted">{connection.host}:{connection.port ?? "-"}</span>
            </div>
          ) : null
        }
        right={
          <button
            type="button"
            onClick={(e) => setNewTabMenu({ x: e.clientX, y: e.clientY })}
            className="flex items-center gap-1.5 rounded border border-border-subtle bg-surface-elevated px-2 py-1 text-body text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
            title="Nueva pestaña"
          >
            <Plus className="h-3 w-3" />
            <span>Nueva</span>
          </button>
        }
      />

      <WorkspaceTabsStrip
        items={stored?.openTabs ?? []}
        activeId={stored?.activeTabId ?? null}
        onSelect={(id) => setActiveTab(connectionId, id)}
        onClose={(id) => closeTab(connectionId, id)}
        onPin={(id) => pinTab(connectionId, id)}
        onReorder={(ids) => reorderTabs(connectionId, ids)}
        onContext={(id, x, y) => setCtxMenu({ id, x, y })}
      />

      <div className="flex min-h-0 flex-1">
        <DocumentNavigator
          databases={databases}
          expanded={expandedDbs}
          onToggleDb={toggleDb}
          collectionsPerDb={collectionsPerDb}
          loadingCollections={loadingCollections}
          onSelectCollection={(db, col) => openCollectionTab(db, col, { ephemeral: true })}
          onPinCollection={(db, col) => openCollectionTab(db, col, { ephemeral: false })}
          activeEntityKey={activeEntityKey}
          collapsed={navCollapsed}
          onCollapsedChange={setNavCollapsed}
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {!stored || !activeTab ? (
            stored ? (
              <WelcomeScreen
                session={stored}
                onAction={onWelcomeAction}
                onOpenRecent={onWelcomeRecent}
              />
            ) : null
          ) : (
            <DocTabContent tab={activeTab} connection={connection} fallbackDb={activeDb} />
          )}
        </main>
      </div>

      {ctxMenu && (
        <WorkspaceTabContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)}>
          <button
            type="button"
            onClick={() => { pinTab(connectionId, ctxMenu.id); setCtxMenu(null); }}
            className="block w-full px-3 py-1.5 text-left text-body text-text-muted hover:bg-surface-hover hover:text-text"
          >
            Anclar pestaña
          </button>
          <button
            type="button"
            onClick={() => { closeTab(connectionId, ctxMenu.id); setCtxMenu(null); }}
            className="block w-full px-3 py-1.5 text-left text-body text-text-muted hover:bg-surface-hover hover:text-text"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={() => {
              const ids = (stored?.openTabs ?? []).map((t) => t.id).filter((id) => id !== ctxMenu.id);
              for (const id of ids) closeTab(connectionId, id);
              setCtxMenu(null);
            }}
            className="block w-full px-3 py-1.5 text-left text-body text-text-muted hover:bg-surface-hover hover:text-text"
          >
            Cerrar las demás
          </button>
        </WorkspaceTabContextMenu>
      )}

      {newTabMenu && (
        <WorkspaceTabContextMenu x={newTabMenu.x} y={newTabMenu.y} onClose={() => setNewTabMenu(null)}>
          <button
            type="button"
            onClick={() => { setNewTabMenu(null); openMetricsTab(); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body text-text-muted hover:bg-surface-hover hover:text-text"
          >
            <Activity className="h-3 w-3 text-sky-400" />
            <span>Abrir métricas</span>
          </button>
        </WorkspaceTabContextMenu>
      )}
    </div>
  );
}

function DocTabContent({
  tab,
  connection,
  fallbackDb,
}: {
  tab: WorkspaceTab;
  connection: Connection | null;
  fallbackDb: string;
}) {
  if (!connection) return null;
  if (tab.kind === "entity") {
    return (
      <div className="flex min-h-0 flex-1 overflow-auto">
        <DocumentPage key={tab.id} />
      </div>
    );
  }
  if (tab.kind === "view" && tab.view === "metrics") {
    return (
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <MetricsPanel connection={connection} database={tab.db || fallbackDb} />
      </div>
    );
  }
  return null;
}

function DocumentNavigator({
  databases,
  expanded,
  onToggleDb,
  collectionsPerDb,
  loadingCollections,
  onSelectCollection,
  onPinCollection,
  activeEntityKey,
  collapsed,
  onCollapsedChange,
}: {
  databases: string[];
  expanded: Set<string>;
  onToggleDb: (db: string) => void;
  collectionsPerDb: Record<string, string[]>;
  loadingCollections: Record<string, boolean>;
  onSelectCollection: (db: string, collection: string) => void;
  onPinCollection: (db: string, collection: string) => void;
  activeEntityKey: string | null;
  collapsed: boolean;
  onCollapsedChange: (v: boolean) => void;
}) {
  if (collapsed) {
    return (
      <div className="flex w-9 shrink-0 flex-col items-center gap-1 border-r border-border-subtle bg-surface/40 py-2">
        <button
          type="button"
          onClick={() => onCollapsedChange(false)}
          title="Expandir"
          className="grid h-7 w-7 place-items-center rounded text-text-faint hover:bg-surface-hover hover:text-text"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }
  return (
    <div className="flex w-60 shrink-0 flex-col border-r border-border-subtle bg-surface/40">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border-subtle px-3">
        <span className="text-overline flex-1 text-text-faint">Colecciones</span>
        <button
          type="button"
          onClick={() => onCollapsedChange(true)}
          title="Colapsar"
          className="grid h-6 w-6 place-items-center rounded text-text-faint hover:bg-surface-hover hover:text-text"
        >
          <ChevronDown className="h-3 w-3 rotate-90" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {databases.length === 0 ? (
          <div className="px-3 py-4 text-center text-body text-text-faint">Sin bases.</div>
        ) : (
          databases.map((db) => {
            const isOpen = expanded.has(db);
            const cols = collectionsPerDb[db] ?? [];
            return (
              <div key={db} className="pb-0.5">
                <button
                  type="button"
                  onClick={() => onToggleDb(db)}
                  className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-body text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
                >
                  {isOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                  <Database className="h-3 w-3 shrink-0 text-text-faint" />
                  <span className="min-w-0 flex-1 truncate font-mono">{db}</span>
                  {loadingCollections[db] && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-text-faint" />}
                  {!loadingCollections[db] && cols.length > 0 && (
                    <span className="shrink-0 text-tiny text-text-faint">{cols.length}</span>
                  )}
                </button>
                {isOpen && (
                  <div className="pl-3">
                    {cols.length === 0 && !loadingCollections[db] && (
                      <p className="px-3 py-1 text-body text-text-faint">Sin colecciones.</p>
                    )}
                    {cols.map((col) => {
                      const k = `${db}/${col}`;
                      const isActive = activeEntityKey === k;
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => onSelectCollection(db, col)}
                          onDoubleClick={() => onPinCollection(db, col)}
                          className={cn(
                            "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-body transition-colors",
                            isActive
                              ? "bg-accent-soft text-accent"
                              : "text-text-muted hover:bg-surface-hover hover:text-text",
                          )}
                        >
                          <Database className={cn("h-3 w-3 shrink-0", isActive ? "text-accent" : "text-text-faint")} />
                          <span className="truncate font-mono">{col}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export type { DocumentSession };
