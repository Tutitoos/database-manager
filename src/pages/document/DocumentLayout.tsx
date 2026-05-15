import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, BarChart2, ChevronDown, ChevronRight, Database, FileText, Loader2 } from "lucide-react";
import { Link, Outlet, useNavigate, useSearchParams } from "react-router";
import { useCallback, useEffect, useState } from "react";
import { MetricsPanel } from "@/components/metrics-panel";
import { getProviderUi, parseSettings, ProviderIcon } from "@/lib/providers";
import { mutedText, panel, sectionBorder } from "@/lib/styles";
import type { Connection } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function DocumentLayout() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const connectionId = Number(searchParams.get("id"));
  const activeDb = searchParams.get("db") ?? "";
  const activeCollection = searchParams.get("collection") ?? "";
  const view = searchParams.get("view");

  const [connection, setConnection] = useState<Connection | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());
  const [collectionsPerDb, setCollectionsPerDb] = useState<Record<string, string[]>>({});
  const [loadingDbs, setLoadingDbs] = useState(false);
  const [loadingCollections, setLoadingCollections] = useState<Record<string, boolean>>({});

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
        setDatabases(selected.length > 0 ? all.filter((db) => selected.includes(db)) : all);
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

  function toggleDb(db: string) {
    setExpandedDbs((prev) => {
      const next = new Set(prev);
      if (next.has(db)) { next.delete(db); } else { next.add(db); loadCollections(db); }
      return next;
    });
  }

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
            <span className="grid h-5 w-5 place-items-center rounded text-white" style={{ backgroundColor: provider.color }}>
              <ProviderIcon providerId={connection.plugin_id} className="h-3 w-3" />
            </span>
            <span className="text-sm font-medium text-white">{connection.name}</span>
            <span className={cn("text-xs", mutedText)}>{connection.host}:{connection.port ?? "-"}</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={() => navView("data")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              view !== "metrics" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300"
            )}
          >
            <FileText className="h-3.5 w-3.5" />
            Datos
          </button>
          <button
            onClick={() => navView("metrics")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              view === "metrics" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300"
            )}
          >
            <BarChart2 className="h-3.5 w-3.5" />
            Métricas
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className={cn("flex w-48 shrink-0 flex-col border-r", panel, sectionBorder)}>
          <div className={cn("border-b px-3 py-2 text-xs font-semibold uppercase tracking-[.14em]", sectionBorder, mutedText)}>
            Bases de datos
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {loadingDbs && (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Cargando...
              </div>
            )}
            {databases.map((db) => {
              const expanded = expandedDbs.has(db);
              const collections = collectionsPerDb[db] ?? [];
              const loading = loadingCollections[db];
              return (
                <div key={db}>
                  <button
                    onClick={() => toggleDb(db)}
                    className={cn(
                      "flex w-full items-center gap-2 px-2 py-1 text-left text-xs transition-colors hover:bg-zinc-900",
                      activeDb === db && !activeCollection ? "text-white" : "text-zinc-400"
                    )}
                  >
                    {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                    <Database className="h-3 w-3 shrink-0 text-zinc-500" />
                    <span className="truncate">{db}</span>
                  </button>
                  {expanded && (
                    <div className="pl-6">
                      {loading && (
                        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-600">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Cargando colecciones...
                        </div>
                      )}
                      {collections.map((col) => (
                        <button
                          key={col}
                          onClick={() => selectCollection(db, col)}
                          className={cn(
                            "flex w-full items-center gap-2 border-l-2 px-2 py-1 text-left text-xs transition-colors",
                            activeDb === db && activeCollection === col
                              ? "bg-zinc-900/60 text-white"
                              : "border-transparent text-zinc-500 hover:bg-zinc-900/50 hover:text-zinc-300"
                          )}
                          style={activeDb === db && activeCollection === col ? { borderColor: provider?.color } : undefined}
                        >
                          <FileText className="h-3 w-3 shrink-0 text-zinc-600" />
                          <span className="truncate text-sm">{col}</span>
                        </button>
                      ))}
                      {!loading && collections.length === 0 && (
                        <p className="px-3 py-1.5 text-xs text-zinc-600">Sin colecciones</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {!loadingDbs && databases.length === 0 && (
              <div className={cn("px-4 py-4 text-xs", mutedText)}>No hay bases de datos disponibles.</div>
            )}
          </div>
        </aside>

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
