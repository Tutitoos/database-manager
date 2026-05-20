import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/modal";
import { pushToast } from "@/components/ui/toast";

interface LegacyExport {
  schema_version: number;
  exported_at: string;
  connections: unknown[];
  groups: unknown[];
  credentials: unknown[];
  app_settings: Record<string, unknown>;
}

/** Blocking modal shown once on app boot when the local SQLite still has
 *  legacy tables with data. Forces the user to download a JSON snapshot
 *  before the server-first refactor wipes the client schema.
 *
 *  Acknowledged via `app.migration_export_acked` setting so the modal never
 *  shows again on the same install. */
export function MigrationModal({ onAcknowledged }: { onAcknowledged: () => void }) {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ c: number; g: number; cr: number } | null>(null);

  useEffect(() => {
    void invoke<LegacyExport>("export_legacy_data")
      .then((d) => setCounts({ c: d.connections.length, g: d.groups.length, cr: d.credentials.length }))
      .catch(() => undefined);
  }, []);

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const data = await invoke<LegacyExport>("export_legacy_data");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      // Webview download via anchor — works in Tauri without extra plugins.
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `database-manager-export-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloaded(true);
      pushToast({ level: "success", title: t("migration.exportedToast") });
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  }

  async function handleContinue() {
    try {
      await invoke("set_app_setting", {
        key: "app.migration_export_acked",
        valueJson: JSON.stringify({ at: new Date().toISOString(), downloaded }),
      });
      onAcknowledged();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <Modal>
      <div className="w-full max-w-lg space-y-4 rounded-xl border border-border-subtle bg-surface-overlay p-6 shadow-md">
        <div className="flex items-start gap-3 rounded-md border border-warn/40 bg-warn-soft p-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-warn" />
          <div className="space-y-1 text-body">
            <p className="font-medium text-warn">{t("migration.title")}</p>
            <p className="text-text-muted">{t("migration.body")}</p>
          </div>
        </div>

        {counts && (
          <dl className="rounded-md border border-border-subtle bg-surface-elevated p-3 text-body">
            <Row label={t("migration.counts.connections")} value={counts.c} />
            <Row label={t("migration.counts.groups")} value={counts.g} />
            <Row label={t("migration.counts.credentials")} value={counts.cr} />
          </dl>
        )}

        {error && <p className="text-body text-danger">{error}</p>}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="primary" onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {downloaded ? t("migration.exportAgain") : t("migration.export")}
          </Button>
          <Button variant={downloaded ? "primary" : "ghost"} onClick={handleContinue} disabled={!downloaded}>
            {t("migration.continue")}
          </Button>
        </div>

        {!downloaded && <p className="text-caption text-text-faint">{t("migration.exportFirst")}</p>}
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between border-b border-border-subtle py-1 last:border-b-0">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono text-text">{value}</span>
    </div>
  );
}
