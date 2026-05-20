import { Download, Loader2, RotateCcw, Settings, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Modal } from "@/components/modal";
import { pushToast } from "@/components/ui/toast";
import { SettingsCard, SettingsRow } from "@/components/settings/SettingsCard";
import { checkLatest, checkNativeUpdate, currentVersion, installAndRelaunch, openReleasePage } from "@/lib/updates";
import { saveTextFile } from "@/lib/save-file";
import type { Update } from "@tauri-apps/plugin-updater";
import {
  exportSettingsJson,
  importSettingsJson,
  loadSettings,
  resetSettings,
  setSetting,
  useSettings,
} from "@/store/settings";

export default function GeneralPage() {
  const { t } = useTranslation();
  const s = useSettings();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [version, setVersion] = useState<string>("");
  const [latest, setLatest] = useState<{ version: string; url: string } | null>(null);
  const [nativeUpdate, setNativeUpdate] = useState<Update | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    void loadSettings();
    void currentVersion().then(setVersion);
  }, []);

  async function handleCheckUpdate() {
    setChecking(true);
    try {
      // Prefer native updater (signed builds with endpoint config).
      const native = await checkNativeUpdate();
      if (native) {
        setNativeUpdate(native);
        setLatest({ version: native.version, url: "" });
        pushToast({ level: "info", title: `Versión ${native.version} disponible`, body: "Click Actualizar para instalar." });
        return;
      }
      // Fallback: GitHub releases lookup (manual download).
      const result = await checkLatest();
      if (!result) {
        pushToast({ level: "danger", title: "No se pudo comprobar", body: "No hay respuesta del servidor." });
        return;
      }
      const isNewer = compareSemver(result.version, version) > 0;
      setLatest(isNewer ? result : null);
      if (isNewer) {
        pushToast({ level: "info", title: `Versión ${result.version} disponible`, body: "Abre la página de descarga." });
      } else {
        pushToast({ level: "success", title: "Estás al día", body: `Versión ${version}` });
      }
    } catch (e) {
      pushToast({ level: "danger", title: "No se pudo comprobar", body: String(e) });
    } finally {
      setChecking(false);
    }
  }

  async function handleInstall() {
    if (!nativeUpdate) {
      if (latest) await openReleasePage(latest.url);
      return;
    }
    setInstalling(true);
    try {
      await installAndRelaunch(nativeUpdate, (loaded, total) => {
        if (total) {
          const pct = Math.round((loaded / total) * 100);
          pushToast({ level: "info", title: `Descargando… ${pct}%`, ttl: 1500 });
        }
      });
    } catch (e) {
      pushToast({ level: "danger", title: "Error al instalar", body: String(e) });
    } finally {
      setInstalling(false);
    }
  }

  async function handleExport() {
    const json = await exportSettingsJson();
    const res = await saveTextFile(json, {
      defaultPath: "database-manager-settings.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
      title: t("generalSettings.exportConfig"),
    });
    if (!res.saved) return;
    pushToast({ level: "success", title: t("generalSettings.toasts.exported"), body: res.path ?? t("generalSettings.toasts.exportedBody") });
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      await importSettingsJson(text);
      pushToast({ level: "success", title: t("generalSettings.toasts.imported"), body: t("generalSettings.toasts.importedBody") });
    } catch (err) {
      pushToast({ level: "danger", title: t("generalSettings.toasts.importFailed"), body: String(err) });
    } finally {
      e.target.value = "";
    }
  }

  async function handleClearCache() {
    const keys = ["app:queryHistory", "app:recentTables", "app:sessionsCache"];
    for (const k of keys) localStorage.removeItem(k);
    pushToast({ level: "info", title: t("generalSettings.toasts.cacheCleared"), body: t("generalSettings.toasts.cacheClearedBody") });
  }

  async function handleReset() {
    await resetSettings();
    setResetOpen(false);
    pushToast({ level: "info", title: t("generalSettings.toasts.resetDone"), body: t("generalSettings.toasts.resetDoneBody") });
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 pb-12">
      <header className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg border border-border-subtle bg-surface-elevated text-text">
          <Settings strokeWidth={1.5} className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-h1 text-text">{t("generalSettings.title")}</h1>
          <p className="text-caption text-text-muted">{t("generalSettings.subtitle")}</p>
        </div>
      </header>

      <SettingsCard title={t("generalSettings.version")}>
        <SettingsRow
          label={t("generalSettings.installedVersion")}
          description={`Database Manager · v${version || "…"}${latest ? t("generalSettings.availableSuffix", { version: latest.version }) : ""}`}
          control={
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={handleCheckUpdate} disabled={checking}>
                {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {t("generalSettings.check")}
              </Button>
              {(latest || nativeUpdate) && (
                <Button variant="primary" size="sm" onClick={handleInstall} disabled={installing}>
                  {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {t("generalSettings.update")}
                </Button>
              )}
            </div>
          }
        />
        <SettingsRow
          label={t("generalSettings.notifyOnUpdate")}
          description={t("generalSettings.notifyOnUpdateDescription")}
          control={<Switch checked={s.notifyUpdates} onCheckedChange={(v) => setSetting("notifyUpdates", v)} />}
        />
      </SettingsCard>

      <SettingsCard title={t("generalSettings.maintenance")}>
        <SettingsRow
          label={t("generalSettings.exportConfig")}
          description={t("generalSettings.exportConfigDescription")}
          control={
            <Button variant="secondary" size="sm" onClick={handleExport}>
              <Download className="h-3.5 w-3.5" /> {t("generalSettings.export")}
            </Button>
          }
        />
        <SettingsRow
          label={t("generalSettings.importConfig")}
          description={t("generalSettings.importConfigDescription")}
          control={
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={handleImportFile}
              />
              <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> {t("generalSettings.import")}
              </Button>
            </>
          }
        />
        <SettingsRow
          label={t("generalSettings.clearCache")}
          description={t("generalSettings.clearCacheDescription")}
          control={
            <Button variant="secondary" size="sm" onClick={handleClearCache}>
              <Trash2 className="h-3.5 w-3.5" /> {t("generalSettings.clear")}
            </Button>
          }
        />
        <SettingsRow
          label={t("generalSettings.resetSettings")}
          description={t("generalSettings.resetSettingsDescription")}
          control={
            <Button variant="danger" size="sm" onClick={() => setResetOpen(true)}>
              <RotateCcw className="h-3.5 w-3.5" /> {t("generalSettings.reset")}
            </Button>
          }
        />
      </SettingsCard>

      {resetOpen && (
        <Modal onClose={() => setResetOpen(false)}>
          <div className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-overlay p-5">
            <h2 className="text-h2 text-text">{t("generalSettings.resetConfirmTitle")}</h2>
            <p className="text-body mt-2 text-text-muted">
              {t("generalSettings.resetConfirmBody")}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setResetOpen(false)}>{t("common.cancel")}</Button>
              <Button variant="danger" size="sm" onClick={handleReset}>{t("generalSettings.reset")}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((p) => parseInt(p, 10) || 0);
  const pb = b.split(".").map((p) => parseInt(p, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
