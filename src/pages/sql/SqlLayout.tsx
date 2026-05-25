import { invoke } from "@tauri-apps/api/core";
import { Activity, ChevronDown, ChevronRight, Database, Hash, Loader2, Pin, Table as TableIcon, Trash2, X } from "lucide-react";
import { useNavigate, useSearchParams } from "@/lib/router-compat";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MetricsPanel } from "@/components/metrics-panel-lazy";
import SqlPage from "@/pages/sql/SqlPage";
import SqlQueriesPage from "@/pages/sql/SqlQueriesPage";
import { WorkspaceTabsStrip, WorkspaceTabContextMenu, WorkspaceMenuItem } from "@/components/workspace/WorkspaceTabsStrip";
import { WelcomeScreen, type WelcomeAction } from "@/components/workspace/WelcomeScreen";
import { ConnHeaderLeft, NewTabButton, NavigatorHeader, NavigatorCollapsedRail } from "@/components/workspace/LayoutChrome";
import { parseSettings } from "@/lib/providers";
import { panel } from "@/lib/styles";
import type { Connection } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  useSessionsStore,
  type EntityTab,
  type QueryTab,
  type ViewTab,
  type SqlSession,
  type WorkspaceTab,
} from "@/store/sessions";
import { PageHeader } from "@/components/ui/page-header";
import { useInspectorContextFor } from "@/components/shell/InspectorContext";

export default function SqlLayout() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const connectionId = Number(searchParams.get("id"));

  const { sessions, updateSession, openTab, closeTab, pinTab, setActiveTab, reorderTabs } = useSessionsStore();
  const stored = sessions[connectionId] as SqlSession | undefined;

  const [connection, setConnection] = useState<Connection | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  const [tablesPerDb, setTablesPerDb] = useState<Record<string, string[]>>({});
  const [loadingTables, setLoadingTables] = useState<Record<string, boolean>>({});
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(() => new Set(stored?.expandedDbs ?? []));
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [newTabMenu, setNewTabMenu] = useState<{ x: number; y: number } | null>(null);
  const [navCollapsed, setNavCollapsed] = useState(false);

  // ── Load connection + databases
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

  const loadTables = useCallback((db: string) => {
    if (!connection || tablesPerDb[db] || loadingTables[db]) return;
    setLoadingTables((prev) => ({ ...prev, [db]: true }));
    invoke<string[]>("list_collections", { input: connection, database: db })
      .then((rows) => setTablesPerDb((prev) => ({ ...prev, [db]: rows })))
      .catch(() => undefined)
      .finally(() => setLoadingTables((prev) => ({ ...prev, [db]: false })));
  }, [connection, tablesPerDb, loadingTables]);

  // Auto-load tables for expanded DBs.
  useEffect(() => {
    for (const db of expandedDbs) loadTables(db);
  }, [expandedDbs, loadTables]);

  function toggleDb(db: string) {
    setExpandedDbs((prev) => {
      const next = new Set(prev);
      if (next.has(db)) next.delete(db);
      else next.add(db);
      updateSession(connectionId, { expandedDbs: [...next] });
      return next;
    });
  }

  // ── Active tab
  const activeTab: WorkspaceTab | undefined = useMemo(() => {
    if (!stored || !stored.activeTabId) return undefined;
    return stored.openTabs.find((t) => t.id === stored.activeTabId);
  }, [stored]);

  // ── URL sync: keep ?db=&table=&view= aligned with active tab so child pages can read them.
  useEffect(() => {
    if (!connectionId) return;
    if (!activeTab) return;
    let url = `/connections/sql?id=${connectionId}`;
    if (activeTab.kind === "entity") {
      url += `&db=${encodeURIComponent(activeTab.db)}&table=${encodeURIComponent(activeTab.name)}`;
    } else if (activeTab.kind === "view" && activeTab.view === "metrics") {
      const db = activeTab.db || stored?.activeDb || databases[0] || "";
      url += `&db=${encodeURIComponent(db)}&view=metrics`;
    } else if (activeTab.kind === "query") {
      url += `&view=queries`;
    }
    navigate(url, { replace: true });
    // Also keep legacy nav fields in sync.
    const patch: Partial<SqlSession> = {};
    if (activeTab.kind === "entity") {
      patch.activeDb = activeTab.db;
      patch.activeTable = activeTab.name;
      patch.activeView = "";
    } else if (activeTab.kind === "view") {
      patch.activeView = activeTab.view;
    } else if (activeTab.kind === "query") {
      patch.activeView = "queries";
      patch.activeScriptId = activeTab.scriptId;
    }
    updateSession(connectionId, patch);
  }, [activeTab?.id]);

  // ── Tab actions
  const openTableTab = useCallback(
    (db: string, table: string, opts: { ephemeral: boolean } = { ephemeral: true }) => {
      openTab(
        connectionId,
        {
          kind: "entity",
          entityKind: "table",
          db,
          name: table,
          title: table,
        } as Omit<EntityTab, "id" | "ephemeral" | "pinned" | "createdAt">,
        opts,
      );
    },
    [connectionId, openTab],
  );

  const openQueryTab = useCallback(() => {
    if (!stored) return;
    // Create a fresh script then open a tab for it.
    const scriptId = `s-${Date.now().toString(36)}`;
    const name = `Script ${stored.queryScripts.length + 1}`;
    updateSession(connectionId, {
      queryScripts: [...stored.queryScripts, { id: scriptId, name, sql: "" }],
    });
    openTab(
      connectionId,
      {
        kind: "query",
        scriptId,
        title: name,
      } as Omit<QueryTab, "id" | "ephemeral" | "pinned" | "createdAt">,
      { ephemeral: false },
    );
  }, [connectionId, stored, updateSession, openTab]);

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
    if (action.kind === "new-query") return openQueryTab();
  }

  function onWelcomeRecent(tab: WorkspaceTab) {
    if (tab.kind === "entity") openTableTab(tab.db, tab.name, { ephemeral: false });
    else if (tab.kind === "view") openMetricsTab();
    else if (tab.kind === "query") {
      openTab(
        connectionId,
        {
          kind: "query",
          scriptId: tab.scriptId,
          title: tab.title,
        } as Omit<QueryTab, "id" | "ephemeral" | "pinned" | "createdAt">,
        { ephemeral: false },
      );
    }
  }

  const activeEntityKey = activeTab?.kind === "entity" ? `${activeTab.db}/${activeTab.name}` : null;
  const activeDb = activeTab?.kind === "entity" ? activeTab.db : (stored?.activeDb || databases[0] || "");

  useInspectorContextFor({
    connection,
    database: activeDb || null,
    table: activeTab?.kind === "entity" ? activeTab.name : null,
    tableLabel: "Table",
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
        <SqlNavigator
          databases={databases}
          expanded={expandedDbs}
          onToggleDb={toggleDb}
          tablesPerDb={tablesPerDb}
          loadingTables={loadingTables}
          onSelectTable={(db, tbl) => openTableTab(db, tbl, { ephemeral: true })}
          onPinTable={(db, tbl) => openTableTab(db, tbl, { ephemeral: false })}
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
            <SqlTabContent tab={activeTab} connection={connection} fallbackDb={activeDb} />
          )}
        </main>
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
            icon={<Hash className="h-3 w-3 text-amber-400" />}
            label="Nueva query"
            onClick={() => { setNewTabMenu(null); openQueryTab(); }}
          />
          <WorkspaceMenuItem
            icon={<Activity className="h-3 w-3 text-sky-400" />}
            label="Abrir métricas"
            onClick={() => { setNewTabMenu(null); openMetricsTab(); }}
          />
        </WorkspaceTabContextMenu>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab content dispatcher (kept inline — small enough not to extract)
// ─────────────────────────────────────────────────────────────────────────────

function SqlTabContent({
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
    // SqlPage still reads URL params; the layout's URL sync keeps them aligned.
    return (
      <div className="flex min-h-0 flex-1 overflow-auto">
        <SqlPage key={tab.id} />
      </div>
    );
  }
  if (tab.kind === "query") {
    return (
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <SqlQueriesPage connection={connection} database={fallbackDb} />
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

// ─────────────────────────────────────────────────────────────────────────────
// SQL navigator: collapsible DB → tables tree
// ─────────────────────────────────────────────────────────────────────────────

function SqlNavigator({
  databases,
  expanded,
  onToggleDb,
  tablesPerDb,
  loadingTables,
  onSelectTable,
  onPinTable,
  activeEntityKey,
  collapsed,
  onCollapsedChange,
}: {
  databases: string[];
  expanded: Set<string>;
  onToggleDb: (db: string) => void;
  tablesPerDb: Record<string, string[]>;
  loadingTables: Record<string, boolean>;
  onSelectTable: (db: string, table: string) => void;
  onPinTable: (db: string, table: string) => void;
  activeEntityKey: string | null;
  collapsed: boolean;
  onCollapsedChange: (v: boolean) => void;
}) {
  if (collapsed) {
    return <NavigatorCollapsedRail onExpand={() => onCollapsedChange(false)} />;
  }
  const totalTables = Object.values(tablesPerDb).reduce((n, ts) => n + ts.length, 0);
  return (
    <div className="flex w-60 shrink-0 flex-col border-r border-border-subtle bg-surface/40">
      <NavigatorHeader
        title="Tablas"
        count={totalTables > 0 ? totalTables : undefined}
        onCollapse={() => onCollapsedChange(true)}
      />
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {databases.length === 0 ? (
          <div className="px-3 py-4 text-center text-body text-text-faint">Sin bases.</div>
        ) : (
          databases.map((db) => {
            const isOpen = expanded.has(db);
            const tables = tablesPerDb[db] ?? [];
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
                  {loadingTables[db] && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-text-faint" />}
                  {!loadingTables[db] && tables.length > 0 && (
                    <span className="shrink-0 text-tiny text-text-faint">{tables.length}</span>
                  )}
                </button>
                {isOpen && (
                  <div className="pl-3">
                    {tables.length === 0 && !loadingTables[db] && (
                      <p className="px-3 py-1 text-body text-text-faint">Sin tablas.</p>
                    )}
                    {tables.map((tbl) => {
                      const k = `${db}/${tbl}`;
                      const isActive = activeEntityKey === k;
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => onSelectTable(db, tbl)}
                          onDoubleClick={() => onPinTable(db, tbl)}
                          className={cn(
                            "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-body transition-colors",
                            isActive
                              ? "bg-accent-soft text-accent"
                              : "text-text-muted hover:bg-surface-hover hover:text-text",
                          )}
                        >
                          <TableIcon className={cn("h-3 w-3 shrink-0", isActive ? "text-accent" : "text-text-faint")} />
                          <span className="truncate font-mono">{tbl}</span>
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

export type { SqlSession };
