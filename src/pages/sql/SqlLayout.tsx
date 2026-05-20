import { invoke } from "@tauri-apps/api/core";
import { Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "@/lib/router-compat";
import { useEffect, useState } from "react";
import { MetricsPanel } from "@/components/metrics-panel";
import SqlQueriesPage from "@/pages/sql/SqlQueriesPage";
import { parseSettings } from "@/lib/providers";
import { panel } from "@/lib/styles";
import type { Connection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useSessionsStore, type SqlSession } from "@/store/sessions";
import { PageHeader, SegmentedTabs } from "@/components/ui/page-header";
import { useInspectorContextFor } from "@/components/shell/InspectorContext";

export default function SqlLayout() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const connectionId = Number(searchParams.get("id"));
  const activeDb = searchParams.get("db") ?? "";
  const activeTable = searchParams.get("table") ?? "";
  const view = searchParams.get("view");

  const { sessions, updateSession } = useSessionsStore();

  const [connection, setConnection] = useState<Connection | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);

  useEffect(() => {
    if (!connectionId) return;
    updateSession(connectionId, { activeDb, activeTable, activeView: view ?? "" });
  }, [activeDb, activeTable, view, connectionId]);

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
        if (!activeDb && dbs.length > 0) {
          navigate(`/connections/sql?id=${connectionId}&db=${encodeURIComponent(dbs[0])}`, { replace: true });
        }
      })
      .catch(() => setDatabases([]));
  }, [connection]);

  function navView(target: "data" | "metrics" | "queries") {
    const db = activeDb || databases[0] || "";
    if (target === "metrics") {
      navigate(`/connections/sql?id=${connectionId}&db=${encodeURIComponent(db)}&view=metrics`);
    } else if (target === "queries") {
      navigate(`/connections/sql?id=${connectionId}&db=${encodeURIComponent(db)}&view=queries`);
    } else {
      navigate(`/connections/sql?id=${connectionId}&db=${encodeURIComponent(activeDb)}&table=${encodeURIComponent(activeTable)}`);
    }
  }

  const metricsDb = activeDb || databases[0] || connection?.database || "";

  useInspectorContextFor({
    connection,
    database: activeDb || null,
    table: activeTable || null,
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

  const tabValue = view === "metrics" ? "metrics" : view === "queries" ? "queries" : "data";

  return (
    <div className={cn("flex min-w-0 flex-1 flex-col", panel)}>
      <PageHeader
        subtitle={
          connection ? (
            <span className="inline-flex items-center gap-1 font-mono">
              <span className="text-text-muted">{connection.name}</span>
              {activeDb && (
                <>
                  <span className="text-text-faint">›</span>
                  <span className="text-text-muted">{activeDb}</span>
                </>
              )}
              {activeTable && (
                <>
                  <span className="text-text-faint">›</span>
                  <span className="text-text">{activeTable}</span>
                </>
              )}
            </span>
          ) : undefined
        }
        right={
          <SegmentedTabs
            value={tabValue}
            onChange={(v) => navView(v as "data" | "metrics" | "queries")}
            options={[
              { value: "data", label: t("common.data") },
              { value: "queries", label: t("common.queries") },
              { value: "metrics", label: t("common.metrics") },
            ]}
          />
        }
      />

      <main
        className={
          view === "metrics" || view === "queries"
            ? "min-h-0 flex-1 overflow-hidden"
            : "min-h-0 flex-1 overflow-auto"
        }
      >
        {view === "metrics" && connection && metricsDb ? (
          <MetricsPanel connection={connection} database={metricsDb} />
        ) : view === "queries" && connection ? (
          <SqlQueriesPage connection={connection} database={metricsDb} />
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}

// Note: SqlSession + DnD imports intentionally pruned — sidebar is now global.
export type { SqlSession };
