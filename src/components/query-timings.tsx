import { History, Server, Monitor } from "lucide-react";
import { useState } from "react";
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
  if (ms < 50) return "text-emerald-400";
  if (ms < 200) return "text-blue-400";
  if (ms < 500) return "text-amber-400";
  return "text-red-400";
}

function relativeTime(at: number): string {
  const diff = Math.max(0, Date.now() - at);
  if (diff < 1000) return "ahora";
  if (diff < 60_000) return `hace ${Math.floor(diff / 1000)}s`;
  return `hace ${Math.floor(diff / 60_000)}m`;
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
  if (queryMs == null) return null;
  const total = (queryMs ?? 0) + (renderMs ?? 0);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-zinc-800/80 bg-zinc-900/40 px-2 py-1 text-[10.5px] text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-900/80"
        title="Detalle de tiempos"
      >
        <Server className="h-3 w-3 text-zinc-500" />
        <span className={cn("font-mono", tone(queryMs))}>{fmt(queryMs)}</span>
        {renderMs != null && (
          <>
            <span className="text-zinc-700">·</span>
            <Monitor className="h-3 w-3 text-zinc-500" />
            <span className={cn("font-mono", tone(renderMs))}>{fmt(renderMs)}</span>
          </>
        )}
        <History className="ml-1 h-3 w-3 text-zinc-500" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-40 mt-1.5 w-[260px] overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl">
            <div className="border-b border-zinc-800/80 px-3 py-2">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-500">
                <span>Última query</span>
                <span className="font-mono">{fmt(total)} total</span>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <Pill icon={<Server className="h-3 w-3" />} label="DB" value={fmt(queryMs)} accent={tone(queryMs)} />
                <Pill
                  icon={<Monitor className="h-3 w-3" />}
                  label="Render"
                  value={renderMs != null ? fmt(renderMs) : "—"}
                  accent={renderMs != null ? tone(renderMs) : "text-zinc-500"}
                />
              </div>
            </div>
            <div className="max-h-60 overflow-auto">
              {history.length === 0 ? (
                <p className="px-3 py-3 text-[11px] text-zinc-500">Sin historial.</p>
              ) : (
                history
                  .slice()
                  .reverse()
                  .map((h, i) => (
                    <div
                      key={`${h.at}-${i}`}
                      className="flex items-center justify-between border-b border-zinc-900/80 px-3 py-1.5 text-[10.5px] last:border-b-0"
                    >
                      <span className="truncate text-zinc-500">{h.label ?? relativeTime(h.at)}</span>
                      <span className="flex shrink-0 items-center gap-1.5 font-mono">
                        <Server className="h-2.5 w-2.5 text-zinc-600" />
                        <span className={tone(h.queryMs)}>{fmt(h.queryMs)}</span>
                        <span className="text-zinc-700">·</span>
                        <Monitor className="h-2.5 w-2.5 text-zinc-600" />
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
    <div className="rounded-md border border-zinc-800/70 bg-zinc-900/40 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-wider text-zinc-500">
        {icon}
        {label}
      </div>
      <div className={cn("mt-0.5 font-mono text-[12px]", accent)}>{value}</div>
    </div>
  );
}
