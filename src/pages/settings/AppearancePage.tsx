import { Check, Palette, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsCard, SettingsRow } from "@/components/settings/SettingsCard";
import {
  ACCENTS,
  setAccent,
  setCustomAccentHex,
  setLocale,
  setSchedule,
  setTheme,
  THEMES,
  useAppearance,
  type Accent,
  type Locale,
  type ThemeMode,
} from "@/lib/theme";
import { getZoom, setZoom, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, zoomIn, zoomOut, zoomReset } from "@/lib/zoom";
import { cn } from "@/lib/utils";

const ACCENT_HEX: Record<Exclude<Accent, "custom">, string> = {
  cyan: "#0ea5e9",
  violet: "#7c3aed",
  emerald: "#10b981",
  amber: "#f59e0b",
  rose: "#f43f5e",
  indigo: "#6366f1",
};

export default function AppearancePage() {
  const { t } = useTranslation();
  const a = useAppearance();
  const [zoom, setZoomState] = useState<number>(getZoom());

  useEffect(() => {
    setZoomState(getZoom());
  }, []);

  async function handleZoom(z: number) {
    await setZoom(z);
    setZoomState(getZoom());
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 pb-12">
      <header className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg border border-border-subtle bg-surface-elevated text-text">
          <Palette strokeWidth={1.5} className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-h1 text-text">{t("appearance.title")}</h1>
          <p className="text-caption text-text-muted">{t("appearance.subtitle")}</p>
        </div>
      </header>

      <SettingsCard title={t("appearance.theme.title")}>
        <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
          {THEMES.map((th) => (
            <ThemeTile
              key={th}
              theme={th}
              label={t(`appearance.theme.${th}`)}
              active={a.theme === th}
              onClick={() => setTheme(th)}
            />
          ))}
        </div>
        {a.theme === "schedule" && (
          <SettingsRow
            label={t("appearance.theme.scheduleLabel")}
            description={t("appearance.theme.scheduleDescription")}
            control={
              <div className="flex items-center gap-2 text-body">
                <span className="text-text-faint">{t("appearance.theme.scheduleDark")}</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={a.scheduleDarkAt}
                  onChange={(e) => setSchedule(parseInt(e.target.value, 10) || 0, a.scheduleLightAt)}
                  className="h-7 w-14 rounded-md border border-border-subtle bg-surface px-2 text-center"
                />
                <span className="text-text-faint">· {t("appearance.theme.scheduleLight")}</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={a.scheduleLightAt}
                  onChange={(e) => setSchedule(a.scheduleDarkAt, parseInt(e.target.value, 10) || 0)}
                  className="h-7 w-14 rounded-md border border-border-subtle bg-surface px-2 text-center"
                />
              </div>
            }
          />
        )}
      </SettingsCard>

      <SettingsCard title={t("appearance.accent.title")}>
        <div className="flex flex-wrap items-center gap-2 p-3">
          {ACCENTS.map((ac) => (
            <button
              key={ac}
              type="button"
              onClick={() => setAccent(ac)}
              title={t(`appearance.accent.${ac}`)}
              className={cn(
                "relative h-8 w-8 rounded-full border-2 transition-transform",
                a.accent === ac ? "border-text scale-110" : "border-transparent hover:scale-105",
              )}
              style={{ background: ACCENT_HEX[ac as Exclude<Accent, "custom">] }}
            >
              {a.accent === ac && (
                <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" strokeWidth={2.5} />
              )}
            </button>
          ))}
          <label
            className={cn(
              "relative grid h-8 w-8 cursor-pointer place-items-center rounded-full border-2 text-tiny font-semibold",
              a.accent === "custom" ? "border-text" : "border-border-strong hover:border-text-muted",
            )}
            style={{
              background:
                a.accent === "custom"
                  ? a.customAccentHex
                  : "conic-gradient(from 90deg, #ef4444, #f59e0b, #10b981, #0ea5e9, #6366f1, #ef4444)",
            }}
            title={t("appearance.accent.customTitle")}
          >
            <input
              type="color"
              value={a.customAccentHex}
              onChange={(e) => setCustomAccentHex(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            {a.accent !== "custom" && <span className="text-white drop-shadow">+</span>}
          </label>
          {a.accent === "custom" && (
            <input
              type="text"
              value={a.customAccentHex}
              onChange={(e) => setCustomAccentHex(e.target.value)}
              className="text-body-mono h-7 w-24 rounded-md border border-border-subtle bg-surface px-2 text-text"
              placeholder="#0ea5e9"
            />
          )}
        </div>
      </SettingsCard>

      <SettingsCard title={t("appearance.zoom.title")}>
        <SettingsRow
          label={t("appearance.zoom.label")}
          description={t("appearance.zoom.description", { percent: Math.round(zoom * 100) })}
          control={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { void zoomOut(); setZoomState(getZoom()); }}
                className="grid h-7 w-7 place-items-center rounded-md border border-border-subtle hover:bg-surface-hover"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <input
                type="range"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step={ZOOM_STEP}
                value={zoom}
                onChange={(e) => void handleZoom(parseFloat(e.target.value))}
                className="h-1 w-40 accent-accent"
              />
              <button
                type="button"
                onClick={() => { void zoomIn(); setZoomState(getZoom()); }}
                className="grid h-7 w-7 place-items-center rounded-md border border-border-subtle hover:bg-surface-hover"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => { void zoomReset(); setZoomState(getZoom()); }}
                className="text-caption h-7 rounded-md border border-border-subtle px-2 text-text-muted hover:bg-surface-hover"
              >
                {t("appearance.zoom.reset")}
              </button>
            </div>
          }
        />
      </SettingsCard>

      <SettingsCard title={t("appearance.language.title")}>
        <SettingsRow
          label={t("appearance.language.label")}
          description={t("appearance.language.description")}
          control={
            <SegmentedTabs
              value={a.locale}
              options={[
                { value: "es", label: t("appearance.language.es") },
                { value: "en", label: t("appearance.language.en") },
              ]}
              onChange={(v) => setLocale(v as Locale)}
            />
          }
        />
      </SettingsCard>
    </div>
  );
}

function ThemeTile({ theme, label, active, onClick }: { theme: ThemeMode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group/tile relative flex flex-col items-stretch overflow-hidden rounded-lg border bg-surface text-left transition-all",
        active ? "border-accent ring-2 ring-accent-ring" : "border-border-subtle hover:border-border-strong",
      )}
    >
      <ThemePreview theme={theme} />
      <div className="flex items-center justify-between border-t border-border-subtle bg-surface-elevated px-2.5 py-1.5">
        <span className="text-body text-text">{label}</span>
        {active && <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.5} />}
      </div>
    </button>
  );
}

function ThemePreview({ theme }: { theme: ThemeMode }) {
  const themePreviewVars = themePreviewMap[theme];
  return (
    <div
      className="flex h-20 w-full"
      style={{
        background: themePreviewVars.bg,
        color: themePreviewVars.text,
      }}
    >
      <div className="w-1/3 border-r" style={{ background: themePreviewVars.surface, borderColor: themePreviewVars.border }}>
        <div className="h-1.5 w-3/4 m-1.5 rounded" style={{ background: themePreviewVars.muted }} />
        <div className="h-1.5 w-1/2 mx-1.5 mb-1 rounded" style={{ background: themePreviewVars.faint }} />
        <div className="h-1.5 w-2/3 mx-1.5 rounded" style={{ background: themePreviewVars.faint }} />
      </div>
      <div className="flex-1 p-1.5">
        <div className="h-2 w-1/2 rounded" style={{ background: themePreviewVars.text }} />
        <div className="mt-1.5 h-1.5 w-3/4 rounded" style={{ background: themePreviewVars.muted }} />
        <div className="mt-1 h-1.5 w-2/3 rounded" style={{ background: themePreviewVars.muted }} />
        <div className="mt-2 inline-block h-3 w-10 rounded" style={{ background: themePreviewVars.accent }} />
      </div>
    </div>
  );
}

const themePreviewMap: Record<ThemeMode, { bg: string; surface: string; text: string; muted: string; faint: string; border: string; accent: string }> = {
  light: { bg: "#f5f5f7", surface: "#ffffff", text: "#0a0a0a", muted: "#a1a1aa", faint: "#d4d4d8", border: "#e4e4e7", accent: "#0ea5e9" },
  dark: { bg: "#141416", surface: "#1c1c1e", text: "#f5f5f5", muted: "#71717a", faint: "#3f3f46", border: "#27272a", accent: "#0ea5e9" },
  system: { bg: "#1c1c1e", surface: "#27272a", text: "#f5f5f5", muted: "#71717a", faint: "#3f3f46", border: "#27272a", accent: "#0ea5e9" },
  midnight: { bg: "#000000", surface: "#08080a", text: "#ffffff", muted: "#6d6d76", faint: "#27272a", border: "#1a1a1e", accent: "#0ea5e9" },
  sepia: { bg: "#f5ecd9", surface: "#f0e4c8", text: "#4b3a1f", muted: "#7a6440", faint: "#c4ad7e", border: "#d4be8e", accent: "#a85d16" },
  solarized: { bg: "#002b36", surface: "#073642", text: "#fdf6e3", muted: "#93a1a1", faint: "#586e75", border: "#0a4452", accent: "#268bd2" },
  schedule: { bg: "linear-gradient(135deg, #f5f5f7 0%, #f5f5f7 49%, #141416 51%, #141416 100%)", surface: "linear-gradient(135deg, #ffffff 0%, #ffffff 49%, #1c1c1e 51%, #1c1c1e 100%)", text: "#71717a", muted: "#9ca3af", faint: "#a1a1aa", border: "#27272a", accent: "#0ea5e9" },
};

function SegmentedTabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: React.ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-border-subtle bg-surface-sunken p-0.5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "text-body h-6 rounded-sm px-2.5 font-medium transition-colors",
              active ? "bg-surface-elevated text-text shadow-sm" : "text-text-muted hover:bg-surface-hover hover:text-text",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
