import { invoke } from "@tauri-apps/api/core";
import { Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "@/lib/router-compat";
import { useEffect, useState } from "react";
import { MetricsPanel } from "@/components/metrics-panel";
import { parseSettings } from "@/lib/providers";
import { panel } from "@/lib/styles";
import type { Connection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useSessionsStore, type DocumentSession } from "@/store/sessions";
import { PageHeader, SegmentedTabs } from "@/components/ui/page-header";
import { useInspectorContextFor } from "@/components/shell/InspectorContext";

export default function DocumentLayout() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const connectionId = Number(searchParams.get("id"));
  const activeDb = searchParams.get("db") ?? "";
  const activeCollection = searchParams.get("collection") ?? "";
  const view = searchParams.get("view");

  const { sessions, updateSession } = useSessionsStore();

  const [connection, setConnection] = useState<Connection | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);

  useEffect(() => {
    if (!connectionId) return;
    updateSession(connectionId, { activeDb, activeCollection, activeView: view ?? "" });
  }, [activeDb, activeCollection, view, connectionId]);

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
          navigate(`/connections/document?id=${connectionId}&db=${encodeURIComponent(dbs[0])}`, { replace: true });
        }
      })
      .catch(() => setDatabases([]));
  }, [connection]);

  function navView(target: "data" | "metrics") {
    const db = activeDb || databases[0] || "";
    if (target === "metrics") {
      navigate(`/connections/document?id=${connectionId}&db=${encodeURIComponent(db)}&view=metrics`);
    } else {
      navigate(`/connections/document?id=${connectionId}&db=${encodeURIComponent(activeDb)}&collection=${encodeURIComponent(activeCollection)}`);
    }
  }

  const metricsDb = activeDb || databases[0] || connection?.database || "";

  useInspectorContextFor({
    connection,
    database: activeDb || null,
    table: activeCollection || null,
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
        title={connection ? activeCollection || activeDb || connection.name : ""}
        subtitle={
          connection
            ? `${connection.plugin_id} · ${connection.host}${connection.port ? ":" + connection.port : ""}`
            : undefined
        }
        right={
          <SegmentedTabs
            value={view === "metrics" ? "metrics" : "data"}
            onChange={(v) => navView(v as "data" | "metrics")}
            options={[
              { value: "data", label: t("common.data") },
              { value: "metrics", label: t("common.metrics") },
            ]}
          />
        }
      />

      <main className={view === "metrics" ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-auto"}>
        {view === "metrics" && connection && metricsDb
          ? <MetricsPanel connection={connection} database={metricsDb} />
          : <Outlet />}
      </main>
    </div>
  );
}

export type { DocumentSession };
