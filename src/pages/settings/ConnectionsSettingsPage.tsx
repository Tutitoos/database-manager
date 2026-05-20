import { Plug } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { SettingsCard, SettingsRow } from "@/components/settings/SettingsCard";
import { Switch } from "@/components/ui/switch";
import { loadSettings, setSetting, useSettings } from "@/store/settings";

export default function ConnectionsSettingsPage() {
  const { t } = useTranslation();
  const s = useSettings();

  useEffect(() => { void loadSettings(); }, []);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 pb-12">
      <header className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg border border-border-subtle bg-surface-elevated text-text">
          <Plug strokeWidth={1.5} className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-h1 text-text">{t("connections.settingsTitle")}</h1>
          <p className="text-caption text-text-muted">{t("connections.settingsSubtitle")}</p>
        </div>
      </header>

      <SettingsCard title={t("connections.settingsTitle")}>
        <SettingsRow
          label={t("connections.confirmDelete")}
          description={t("connections.confirmDeleteDescription")}
          control={<Switch checked={s.confirmDelete} onCheckedChange={(v) => setSetting("confirmDelete", v)} />}
        />
        <SettingsRow
          label={t("connections.autoConnect")}
          description={t("connections.autoConnectDescription")}
          control={<Switch checked={s.autoConnect} onCheckedChange={(v) => setSetting("autoConnect", v)} />}
        />
        <SettingsRow
          label={t("connections.showBadges")}
          description={t("connections.showBadgesDescription")}
          control={<Switch checked={s.showSidebarBadges} onCheckedChange={(v) => setSetting("showSidebarBadges", v)} />}
        />
        <SettingsRow
          label={t("connections.restoreLastSession")}
          description={t("connections.restoreLastSessionDescription")}
          control={<Switch checked={s.restoreLastSession} onCheckedChange={(v) => setSetting("restoreLastSession", v)} />}
        />
      </SettingsCard>
    </div>
  );
}
