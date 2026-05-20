import { invoke } from "@tauri-apps/api/core";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Folder,
  Star,
  Table as TableIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "@/lib/router-compat";
import { ProviderIcon, PROVIDER_UI, parseSettings } from "@/lib/providers";
import type { Connection, ConnectionGroup } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useSessionsStore } from "@/store/sessions";
import { useSettings } from "@/store/settings";
import { UserMenu } from "@/components/shell/UserMenu";
import { OrgSwitcher } from "@/components/shell/OrgSwitcher";
import { useOpenConnection } from "@/components/connect-gate";
import { pushToast } from "@/components/ui/toast";

export function Sidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const currentId = Number(searchParams.get("id"));
  const sidebarDb = searchParams.get("db") ?? "";
  const sidebarTable = searchParams.get("table") ?? "";
  const { sessions } = useSessionsStore();
  const { showSidebarBadges } = useSettings();
  const openConnection = useOpenConnection();

  const [connections, setConnections] = useState<Connection[]>([]);
  const [groups, setGroups] = useState<ConnectionGroup[]>([]);
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<number | null>>(new Set([null]));
  const [activeDbs, setActiveDbs] = useState<string[]>([]);
  const [activeTables, setActiveTables] = useState<Record<string, string[]>>({});

  // Load connections + groups whenever active org changes.
  useEffect(() => {
    const load = () => {
      invoke<Connection[]>("list_connections").then(setConnections).catch(() => setConnections([]));
      invoke<ConnectionGroup[]>("list_groups").then(setGroups).catch(() => setGroups([]));
    };
    load();
    const handler = () => load();
    window.addEventListener("app:org-changed", handler);
    return () => window.removeEventListener("app:org-changed", handler);
  }, []);

  // Load favorites from settings.
  useEffect(() => {
    invoke<string | null>("get_app_setting", { key: "app.favorites" })
      .then((raw) => {
        if (!raw) return;
        try {
          const ids = JSON.parse(raw) as number[];
          setFavorites(new Set(Array.isArray(ids) ? ids : []));
        } catch {
          /* ignore */
        }
      })
      .catch(() => undefined);
  }, []);

  // Persist favorites.
  const persistFavorites = useCallback((next: Set<number>) => {
    void invoke("set_app_setting", {
      key: "app.favorites",
      valueJson: JSON.stringify([...next]),
    }).catch(() => undefined);
  }, []);

  function toggleFavorite(id: number) {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistFavorites(next);
      return next;
    });
  }

  const activeConnection = useMemo(() => sessions[currentId]?.connection ?? null, [sessions, currentId]);

  // Load DBs of active connection.
  useEffect(() => {
    if (!activeConnection) {
      setActiveDbs([]);
      return;
    }
    invoke<string[]>("list_databases", { input: activeConnection })
      .then((all) => {
        // Honour the per-connection selectedDatabases filter set in the
        // connection dialog. Without this the sidebar lists every db the
        // server exposes — confusing when the user explicitly scoped down.
        const settings = parseSettings(activeConnection.settings_json);
        const selected = Array.isArray(settings.selectedDatabases)
          ? (settings.selectedDatabases as string[])
          : [];
        const filtered = selected.length > 0 ? all.filter((db) => selected.includes(db)) : all;
        setActiveDbs(filtered);
      })
      .catch(() => setActiveDbs([]));
  }, [activeConnection]);

  function navigateToTable(db: string, table: string) {
    if (!activeConnection) return;
    const id = activeConnection.id;
    const kind =
      activeConnection.plugin_id === "mongodb"
        ? "document"
        : activeConnection.plugin_id === "redis"
        ? "redis"
        : "sql";
    const param = kind === "document" ? "collection" : kind === "redis" ? "key" : "table";
    navigate(`/connections/${kind}?id=${id}&db=${encodeURIComponent(db)}&${param}=${encodeURIComponent(table)}`);
    // Background test: warn (no block) if connection has dropped.
    invoke("test_connection", { input: activeConnection }).catch((e) => {
      pushToast({
        level: "warn",
        title: "Conexión inestable",
        body: String(e),
      });
    });
  }


  const favoriteList = useMemo(
    () => connections.filter((c) => favorites.has(c.id)),
    [connections, favorites],
  );

  const byGroup = useMemo(() => {
    const map = new Map<number | null, Connection[]>();
    for (const c of connections) {
      const gid = c.group_id ?? null;
      if (!map.has(gid)) map.set(gid, []);
      map.get(gid)!.push(c);
    }
    return map;
  }, [connections]);

  function toggleWorkspace(gid: number | null) {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border-subtle bg-surface text-text">
      <OrgSwitcher />
      <div className="flex-1 overflow-y-auto isolate">
        {favoriteList.length > 0 && (
          <Section title={t("sidebar.favorites")} icon={<Star strokeWidth={1.5} className="h-3 w-3" />}>
            {favoriteList.map((c) => (
              <ConnRow
                key={c.id}
                connection={c}
                active={currentId === c.id}
                favorite
                onClick={() => openConnection(c)}
                onToggleFavorite={() => toggleFavorite(c.id)}
              />
            ))}
          </Section>
        )}

        {!activeConnection && (
        <Section title={t("sidebar.workspaces")} icon={<Folder strokeWidth={1.5} className="h-3 w-3" />}>
          {[{ id: null, name: "Sin carpeta" } as { id: number | null; name: string }, ...groups]
            .map((g) => {
              const list = byGroup.get(g.id) ?? [];
              const expanded = expandedWorkspaces.has(g.id);
              if (list.length === 0 && g.id !== null) return null;
              // The implicit "Sin carpeta" bucket renders rows flat without a header.
              if (g.id === null) {
                return (
                  <div key="ungrouped">
                    {list.map((c) => (
                      <ConnRow
                        key={c.id}
                        connection={c}
                        active={currentId === c.id}
                        favorite={favorites.has(c.id)}
                        onClick={() => openConnection(c)}
                        onToggleFavorite={() => toggleFavorite(c.id)}
                      />
                    ))}
                  </div>
                );
              }
              return (
                <div key={String(g.id)}>
                  <div className="px-1.5">
                    <button
                      type="button"
                      onClick={() => toggleWorkspace(g.id)}
                      className="text-overline flex h-5 w-full items-center gap-1.5 rounded-sm px-1 text-left transition-colors hover:bg-surface-hover hover:text-text-muted"
                    >
                      {expanded ? (
                        <ChevronDown strokeWidth={1.5} className="h-2.5 w-2.5 shrink-0" />
                      ) : (
                        <ChevronRight strokeWidth={1.5} className="h-2.5 w-2.5 shrink-0" />
                      )}
                      <span className="truncate">{g.name}</span>
                      {showSidebarBadges && <span className="ml-auto">{list.length}</span>}
                    </button>
                  </div>
                  {expanded &&
                    list.map((c) => (
                      <ConnRow
                        key={c.id}
                        connection={c}
                        active={currentId === c.id}
                        favorite={favorites.has(c.id)}
                        onClick={() => openConnection(c)}
                        onToggleFavorite={() => toggleFavorite(c.id)}
                        indented
                      />
                    ))}
                </div>
              );
            })}
        </Section>
        )}

        {activeConnection && (
          <ActiveConnectionPanel
            connection={activeConnection}
            databases={activeDbs}
            sidebarDb={sidebarDb}
            sidebarTable={sidebarTable}
            activeTables={activeTables}
            setActiveTables={setActiveTables}
            onSelectDb={(db) => {
              const kind =
                activeConnection.plugin_id === "mongodb"
                  ? "document"
                  : activeConnection.plugin_id === "redis"
                    ? "redis"
                    : "sql";
              navigate(`/connections/${kind}?id=${activeConnection.id}&db=${encodeURIComponent(db)}`);
            }}
            onSelectTable={navigateToTable}
          />
        )}
      </div>

      <div className="shrink-0 border-t border-border-subtle p-1">
        <UserMenu />
      </div>
    </aside>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="pb-1">
      <p className="text-overline sticky top-0 z-10 bg-surface/95 px-3 pt-3 pb-1.5 backdrop-blur-sm">
        {title}
      </p>
      {children}
    </div>
  );
}

/** Active-connection sidebar panel: DB selector at top + flat list of tables
 *  for the currently-selected DB. Replaces the previous tree-style expandable
 *  category which felt heavy and made it hard to switch DBs. */
function ActiveConnectionPanel({
  connection,
  databases,
  sidebarDb,
  sidebarTable,
  activeTables,
  setActiveTables,
  onSelectDb,
  onSelectTable,
}: {
  connection: Connection;
  databases: string[];
  sidebarDb: string;
  sidebarTable: string;
  activeTables: Record<string, string[]>;
  setActiveTables: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  onSelectDb: (db: string) => void;
  onSelectTable: (db: string, table: string) => void;
}) {
  const selectedDb = sidebarDb && databases.includes(sidebarDb) ? sidebarDb : databases[0] ?? "";
  const tables = activeTables[selectedDb] ?? [];

  // Lazy-load tables of whichever db is currently selected.
  useEffect(() => {
    if (!selectedDb || activeTables[selectedDb]) return;
    invoke<string[]>("list_collections", { input: connection, database: selectedDb })
      .then((rows) => setActiveTables((prev) => ({ ...prev, [selectedDb]: rows })))
      .catch(() => undefined);
  }, [selectedDb, connection, activeTables, setActiveTables]);

  if (databases.length === 0) {
    return (
      <div className="px-3 pt-3 pb-1.5">
        <Empty>Cargando bases…</Empty>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 pt-3 pb-1">
      <div className="px-2">
        <label className="text-overline mb-1 block px-1">Base</label>
        <div className="relative">
          <Database
            strokeWidth={1.5}
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint"
          />
          <select
            value={selectedDb}
            onChange={(e) => onSelectDb(e.target.value)}
            className="text-body h-8 w-full appearance-none truncate rounded-md border border-border-subtle bg-surface-elevated pl-7 pr-6 font-mono text-text hover:border-border-strong focus:border-accent focus:outline-none"
          >
            {databases.map((db) => (
              <option key={db} value={db}>
                {db}
              </option>
            ))}
          </select>
          <ChevronDown
            strokeWidth={1.5}
            className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-faint"
          />
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between px-3">
        <span className="text-overline">Tablas</span>
        <span className="text-tiny text-text-faint">{tables.length}</span>
      </div>

      {tables.length === 0 ? (
        <Empty>Sin tablas.</Empty>
      ) : (
        tables.map((tbl) => {
          const isActive = tbl === sidebarTable && selectedDb === sidebarDb;
          return (
            <div key={tbl} className="px-1.5">
              <button
                type="button"
                onClick={() => onSelectTable(selectedDb, tbl)}
                className={cn(
                  "text-body-mono flex h-6 w-full items-center gap-1.5 rounded-md px-2 text-left transition-colors",
                  isActive
                    ? "bg-accent-soft text-accent"
                    : "text-text-muted hover:bg-surface-hover hover:text-text",
                )}
              >
                <TableIcon
                  strokeWidth={1.5}
                  className={cn("h-3 w-3 shrink-0", isActive ? "text-accent" : "text-text-faint")}
                />
                <span className="truncate">{tbl}</span>
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-1 text-body text-text-faint">{children}</p>;
}

function ConnRow({
  connection,
  active,
  favorite,
  onClick,
  onToggleFavorite,
  indented,
}: {
  connection: Connection;
  active: boolean;
  favorite: boolean;
  onClick: () => void;
  onToggleFavorite: () => void;
  indented?: boolean;
}) {
  const ui = PROVIDER_UI[connection.plugin_id];
  const color = ui?.color ?? "var(--accent)";
  return (
    <div className={cn("px-1.5", indented && "pl-6")}>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className={cn(
          "text-body group/row flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left leading-none transition-colors",
          active
            ? "bg-accent-soft text-text"
            : "text-text-muted hover:bg-surface-hover hover:text-text",
        )}
      >
        <span
          className="grid h-3.5 w-3.5 shrink-0 place-items-center overflow-hidden rounded-[3px]"
          style={{ background: `color-mix(in srgb, ${color} 22%, transparent)` }}
        >
          <ProviderIcon providerId={connection.plugin_id} className="block h-full w-full object-cover" />
        </span>
        <span className="min-w-0 flex-1 truncate">{connection.name}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className={cn(
            "shrink-0 rounded-sm p-0.5 transition-colors",
            favorite
              ? "text-warn"
              : "text-text-faint opacity-0 group-hover/row:opacity-100 hover:text-warn",
          )}
          title={favorite ? "Quitar de favoritas" : "Marcar favorita"}
        >
          <Star strokeWidth={favorite ? 0 : 1.5} fill={favorite ? "currentColor" : "none"} className="h-2.5 w-2.5" />
        </button>
      </div>
    </div>
  );
}
