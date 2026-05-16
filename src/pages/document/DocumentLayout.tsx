import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, BarChart2, FileText, Loader2, Search, X } from "lucide-react";
import { Link, Outlet } from "@tanstack/react-router";
import { useNavigate, useSearchParams } from "@/lib/router-compat";
import { useCallback, useEffect, useState } from "react";
import { MetricsPanel } from "@/components/metrics-panel";
import { getProviderUi, parseSettings, ProviderIcon } from "@/lib/providers";
import { mutedText, panel, sectionBorder } from "@/lib/styles";
import type { Connection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useSessionsStore, type DocumentSession } from "@/store/sessions";
import { Select } from "@/components/ui/select";

export default function DocumentLayout() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const connectionId = Number(searchParams.get("id"));
  const activeDb = searchParams.get("db") ?? "";
  const activeCollection = searchParams.get("collection") ?? "";
  const view = searchParams.get("view");

  const { sessions, updateSession } = useSessionsStore();
  const stored = sessions[connectionId] as DocumentSession | undefined;

  const [connection, setConnection] = useState<Connection | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  const [collectionsPerDb, setCollectionsPerDb] = useState<Record<string, string[]>>(() => stored?.collectionsPerDb ?? {});
  const [loadingDbs, setLoadingDbs] = useState(false);
  const [loadingCollections, setLoadingCollections] = useState<Record<string, boolean>>({});
  const [collectionSearch, setCollectionSearch] = useState(() => stored?.collectionSearch ?? "");

  useEffect(() => {
    if (!connectionId) return;
    updateSession(connectionId, {
      expandedDbs: [],
      collectionsPerDb,
      collectionSearch,
      activeDb,
      activeCollection,
      activeView: view ?? "",
    });
  }, [collectionsPerDb, collectionSearch, activeDb, activeCollection, view, connectionId]);

  useEffect(() => {
    invoke<Connection[]>("list_connections").then((all) => {
      setConnection(all.find((c) => c.id === connectionId) ?? null);
    });
  }, [connectionId]);

  useEffect(() => {
    if (!connection) return;
    setLoadingDbs(true);
    invoke<string[]>("list_databases", { input: connection })
      .then((all) => {
        const settings = parseSettings(connection.settings_json);
        const selected = Array.isArray(settings.selectedDatabases) ? (settings.selectedDatabases as string[]) : [];
        const dbs = selected.length > 0 ? all.filter((db) => selected.includes(db)) : all;
        setDatabases(dbs);
        if (!activeDb && dbs.length > 0) {
          navigate(`/connections/document?id=${connectionId}&db=${encodeURIComponent(dbs[0])}`, { replace: true });
        }
      })
      .catch(() => setDatabases([]))
      .finally(() => setLoadingDbs(false));
  }, [connection]);

  const loadCollections = useCallback(async (db: string) => {
    if (!connection || collectionsPerDb[db]) return;
    setLoadingCollections((prev) => ({ ...prev, [db]: true }));
    try {
      const cols = await invoke<string[]>("list_collections", { input: connection, database: db });
      setCollectionsPerDb((prev) => ({ ...prev, [db]: cols }));
    } catch {
      setCollectionsPerDb((prev) => ({ ...prev, [db]: [] }));
    } finally {
      setLoadingCollections((prev) => ({ ...prev, [db]: false }));
    }
  }, [connection, collectionsPerDb]);

  useEffect(() => {
    if (activeDb) {
      loadCollections(activeDb);
    }
  }, [activeDb, loadCollections]);

  function selectCollection(db: string, collection: string) {
    navigate(`/connections/document?id=${connectionId}&db=${encodeURIComponent(db)}&collection=${encodeURIComponent(collection)}`);
  }

  function navView(target: "data" | "metrics") {
    const db = activeDb || databases[0] || "";
    if (target === "metrics") {
      navigate(`/connections/document?id=${connectionId}&db=${encodeURIComponent(db)}&view=metrics`);
    } else {
      navigate(`/connections/document?id=${connectionId}&db=${encodeURIComponent(activeDb)}&collection=${encodeURIComponent(activeCollection)}`);
    }
  }

  const provider = connection ? getProviderUi(connection.plugin_id) : null;
  const metricsDb = activeDb || databases[0] || connection?.database || "";

  if (connectionId && !sessions[connectionId]) {
    navigate("/connections", { replace: true });
    return null;
  }

  return (
    <div className={cn("flex min-w-0 flex-1 flex-col", panel)}>
      <header className={cn("flex h-12 shrink-0 items-center gap-3 border-b px-4", panel, sectionBorder)}>
        <Link to="/connections" className="flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-200">
          <ArrowLeft className="h-3.5 w-3.5" />
          Conexiones
        </Link>
        <span className="text-zinc-700">/</span>
        {connection && provider && (
          <div className="flex items-center gap-2">
            <span className="shrink-0 h-5 w-5 overflow-hidden rounded border border-white/10 shadow-inner">
              <ProviderIcon providerId={connection.plugin_id} className="block h-full w-full object-cover" />
            </span>
            <span className="text-sm font-medium text-white">{connection.name}</span>
            <span className={cn("text-xs", mutedText)}>{connection.host}:{connection.port ?? "-"}</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-white/5 bg-black/40 p-1 shadow-inner">
            <button
              onClick={() => navView("data")}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium transition-colors",
                view !== "metrics" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              <BarChart2 className="hidden" />
              Datos
            </button>
            <button
              onClick={() => navView("metrics")}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium transition-colors",
                view === "metrics" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              Métricas
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {view !== "metrics" && (
          <aside className="flex w-64 shrink-0 flex-col border-r border-white/5 bg-zinc-950/50">
            <div className="border-b border-white/5 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[.14em] text-zinc-500 bg-white/[0.01]">
              Colecciones
            </div>

            <div className="border-b border-white/5 bg-zinc-950/20 px-3 py-2">
              <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-black/40 px-2.5 py-1.5 transition-colors focus-within:border-white/20 focus-within:ring-1 focus-within:ring-white/10 shadow-inner">
                <Search className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                <input
                  value={collectionSearch}
                  onChange={(e) => setCollectionSearch(e.target.value)}
                  placeholder="Buscar colecciones..."
                  className="min-w-0 flex-1 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none"
                />
                {collectionSearch && (
                  <button onClick={() => setCollectionSearch("")} className="shrink-0 text-zinc-600 transition-colors hover:text-zinc-400">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto py-1">
              {activeDb && loadingCollections[activeDb] && (
                <div className="flex items-center gap-2 px-4 py-2 text-xs text-zinc-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Cargando colecciones...
                </div>
              )}
              {activeDb && !loadingCollections[activeDb] && (collectionsPerDb[activeDb] ?? [])
                .filter((col) => col.toLowerCase().includes(collectionSearch.toLowerCase()))
                .map((col) => (
                  <button
                    key={col}
                    onClick={() => selectCollection(activeDb, col)}
                    className={cn(
                      "flex w-[calc(100%-16px)] mx-2 my-0.5 items-center gap-3 rounded-lg py-1.5 px-2 text-left text-xs transition-all duration-200",
                      activeCollection === col
                        ? "bg-blue-600/15 text-blue-400 border border-blue-500/20 shadow-lg shadow-blue-900/10"
                        : "border border-transparent text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200 hover:border-white/5"
                    )}
                  >
                    <div className={cn(
                      "grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors",
                      activeCollection === col
                        ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
                        : "border-white/5 bg-white/[0.02] text-zinc-600"
                    )}>
                      <FileText className="h-3 w-3" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className={cn("truncate block font-mono", activeCollection === col ? "text-blue-300" : "text-zinc-200")}>
                        {col}
                      </span>
                    </div>
                  </button>
                ))}
              {activeDb && !loadingCollections[activeDb] && (collectionsPerDb[activeDb] ?? []).length === 0 && (
                <div className="px-4 py-4 text-xs text-zinc-600">
                  No hay colecciones disponibles.
                </div>
              )}
              {!activeDb && !loadingDbs && (
                <div className={cn("px-4 py-4 text-xs", mutedText)}>Selecciona una base de datos.</div>
              )}
            </div>

            <div className="border-t border-white/5 bg-zinc-950/40 px-3 py-2">
              {loadingDbs ? (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Cargando DBs...</span>
                </div>
              ) : (
                <Select
                  value={activeDb}
                  onChange={(val) => navigate(`/connections/document?id=${connectionId}&db=${encodeURIComponent(val)}`)}
                  options={databases.map((db) => ({ value: db, label: db }))}
                  className="text-[11px] h-8 w-full"
                  upward
                />
              )}
            </div>
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <main className={view === "metrics" ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-auto"}>
            {view === "metrics" && connection && metricsDb
              ? <MetricsPanel connection={connection} database={metricsDb} />
              : <Outlet />}
          </main>
        </div>
      </div>
    </div>
  );
}
