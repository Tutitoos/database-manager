import { History, Server, Monitor } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type TimingEntry = {
  queryMs: number;
  renderMs: number;
  totalMs: number;
  at: number;
  label?: string;
};

function fmt(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function tone(ms: number): string {
  if (ms < 50) return "text-success";
  if (ms < 200) return "text-accent";
  if (ms < 500) return "text-amber-400";
  return "text-danger";
}

function useRelativeTime() {
  const { t } = useTranslation();
  return (at: number): string => {
    const diff = Math.max(0, Date.now() - at);
    if (diff < 1000) return t("queryTimings.relativeNow");
    if (diff < 60_000) return t("queryTimings.relativeSecondsAgo", { seconds: Math.floor(diff / 1000) });
    return t("queryTimings.relativeMinutesAgo", { minutes: Math.floor(diff / 60_000) });
  };
}

export function QueryTimings({
  queryMs,
  renderMs,
  history,
}: {
  queryMs: number | null;
  renderMs: number | null;
  history: TimingEntry[];
}) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const relativeTime = useRelativeTime();
  if (queryMs == null) return null;
  const total = (queryMs ?? 0) + (renderMs ?? 0);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-body text-text-muted transition-colors hover:text-text"
        title={t("queryTimings.tooltip")}
      >
        <Server className="h-3 w-3 text-text-faint" />
        <span className="text-text-faint">{t("queryTimings.db")}</span>
        <span className={cn("font-mono", tone(queryMs))}>{fmt(queryMs)}</span>
        {renderMs != null && (
          <>
            <span className="text-text-faint">·</span>
            <Monitor className="h-3 w-3 text-text-faint" />
            <span className="text-text-faint">{t("queryTimings.ui")}</span>
            <span className={cn("font-mono", tone(renderMs))}>{fmt(renderMs)}</span>
          </>
        )}
        <History className="ml-1 h-3 w-3 text-text-faint" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[80]" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-[90] mt-1.5 w-[280px] overflow-hidden rounded-lg border border-border-subtle bg-surface-overlay shadow-2xl ring-1 ring-black/40 backdrop-blur">
            <div className="border-b border-border-subtle px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-overline">{t("queryTimings.lastQuery")}</span>
                <span className="text-caption font-mono text-text-muted">{fmt(total)} {t("queryTimings.totalSuffix")}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Pill icon={<Server className="h-3 w-3" />} label={t("queryTimings.db")} value={fmt(queryMs)} accent={tone(queryMs)} />
                <Pill
                  icon={<Monitor className="h-3 w-3" />}
                  label={t("queryTimings.render")}
                  value={renderMs != null ? fmt(renderMs) : "—"}
                  accent={renderMs != null ? tone(renderMs) : "text-text-faint"}
                />
              </div>
            </div>
            <div className="max-h-60 overflow-auto">
              {history.length === 0 ? (
                <p className="text-caption px-3 py-3 text-text-faint">{t("queryTimings.noHistory")}</p>
              ) : (
                history
                  .slice()
                  .reverse()
                  .map((h, i) => (
                    <div
                      key={`${h.at}-${i}`}
                      className="text-caption flex items-center justify-between border-b border-border-subtle px-3 py-1.5 last:border-b-0"
                    >
                      <span className="truncate text-text-muted">{h.label ?? relativeTime(h.at)}</span>
                      <span className="flex shrink-0 items-center gap-1.5 font-mono">
                        <Server className="h-2.5 w-2.5 text-text-faint" />
                        <span className={tone(h.queryMs)}>{fmt(h.queryMs)}</span>
                        <span className="text-text-faint">·</span>
                        <Monitor className="h-2.5 w-2.5 text-text-faint" />
                        <span className={tone(h.renderMs)}>{fmt(h.renderMs)}</span>
                      </span>
                    </div>
                  ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Pill({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-elevated px-2.5 py-2">
      <div className="flex items-center gap-1 text-overline">
        {icon}
        {label}
      </div>
      <div className={cn("mt-1 text-body-mono", accent)}>{value}</div>
    </div>
  );
}
