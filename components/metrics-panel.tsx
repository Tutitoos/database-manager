"use client";

import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { mutedText, sectionBorder } from "@/lib/styles";
import type { Connection } from "@/lib/types";
import { cn } from "@/lib/utils";

const POLL_MS = 3000;
const MAX_POINTS = 40;

function fmtBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(2)} KB`;
  return `${bytes} B`;
}

function fmtNum(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3">
      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</span>
      <span className="text-lg font-semibold text-white">{value}</span>
      {sub && <span className="text-[10px] text-zinc-600">{sub}</span>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
      <p className="mb-2 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{title}</p>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

const TOOLTIP_STYLE = {
  backgroundColor: "#111",
  border: "1px solid #27272a",
  borderRadius: 6,
  fontSize: 10,
  color: "#e4e4e7",
};

// ── PostgreSQL ───────────────────────────────────────────────────────────────

type PgSnap = {
  ts: number;
  label: string;
  active_connections: number;
  cache_hit_ratio: number;
  xact_commit: number;
  xact_rollback: number;
  blks_read: number;
  blks_hit: number;
  tup_inserted: number;
  tup_updated: number;
  tup_deleted: number;
  [k: string]: unknown;
};

type PgPoint = {
  label: string;
  connections: number;
  cache_pct: number;
  tps: number;
  wps: number; // writes/s = insert+update+delete
};

function buildPgSeries(snaps: PgSnap[]): PgPoint[] {
  if (snaps.length < 2) return snaps.map((s) => ({ label: s.label, connections: s.active_connections, cache_pct: s.cache_hit_ratio, tps: 0, wps: 0 }));
  return snaps.slice(1).map((curr, i) => {
    const prev = snaps[i];
    const dt = Math.max((curr.ts - prev.ts) / 1000, 0.001);
    const tps = Math.max(0, (curr.xact_commit - prev.xact_commit) / dt);
    const wps = Math.max(0, ((curr.tup_inserted - prev.tup_inserted) + (curr.tup_updated - prev.tup_updated) + (curr.tup_deleted - prev.tup_deleted)) / dt);
    return { label: curr.label, connections: curr.active_connections, cache_pct: curr.cache_hit_ratio, tps: Math.round(tps * 10) / 10, wps: Math.round(wps * 10) / 10 };
  });
}

function PgMetricsView({ latest, series, topTables }: {
  latest: PgSnap;
  series: PgPoint[];
  topTables: { schema: string; name: string; size: string; size_bytes: number }[];
}) {
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="grid shrink-0 grid-cols-4 gap-3">
        <StatCard label="Tamaño DB" value={latest.db_size as string} />
        <StatCard label="Conexiones" value={String(latest.active_connections)} sub={latest.max_connections ? `de ${latest.max_connections} máx.` : undefined} />
        <StatCard label="Cache hit" value={`${latest.cache_hit_ratio ?? "—"}%`} />
        <StatCard label="Tablas" value={String(latest.table_count ?? "—")} />
      </div>

      <div className="min-h-0 flex-1 grid grid-cols-2 gap-3">
        <ChartCard title="Conexiones activas">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="gConn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#71717a" }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: "#71717a" }} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Area type="monotone" dataKey="connections" stroke="#8b5cf6" fill="url(#gConn)" strokeWidth={1.5} dot={false} name="Conexiones" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Cache hit ratio (%)">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#71717a" }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#71717a" }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="cache_pct" stroke="#10b981" strokeWidth={1.5} dot={false} name="Cache %" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Transacciones / s">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="gTps" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#71717a" }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: "#71717a" }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Area type="monotone" dataKey="tps" stroke="#3b82f6" fill="url(#gTps)" strokeWidth={1.5} dot={false} name="TPS" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Escrituras / s (ins+upd+del)">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="gWps" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#71717a" }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: "#71717a" }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Area type="monotone" dataKey="wps" stroke="#f59e0b" fill="url(#gWps)" strokeWidth={1.5} dot={false} name="Writes/s" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {topTables.length > 0 && (
        <div className="shrink-0">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Tablas más grandes</p>
          <div className="min-h-52 max-h-72 overflow-auto rounded-lg border border-zinc-800">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="border-b border-zinc-800 bg-zinc-900/90">
                  <th className="px-3 py-2 text-left font-medium text-zinc-400">Tabla</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-400">Tamaño</th>
                </tr>
              </thead>
              <tbody>
                {topTables.map((t, i) => (
                  <tr key={i} className="border-b border-zinc-800/40 hover:bg-zinc-900/40">
                    <td className="px-3 py-2 font-mono text-zinc-300"><span className="text-zinc-600">{t.schema}.</span>{t.name}</td>
                    <td className="px-3 py-2 text-right font-mono text-blue-300/80">{t.size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MongoDB ──────────────────────────────────────────────────────────────────

type MongoSnap = {
  ts: number;
  label: string;
  active_connections: number;
  available_connections: number;
  mem_resident_mb: number;
  mem_virtual_mb: number;
  net_bytes_in: number;
  net_bytes_out: number;
  op_insert: number;
  op_query: number;
  op_update: number;
  op_delete: number;
  op_command: number;
  data_size_bytes: number;
  storage_size_bytes: number;
  [k: string]: unknown;
};

type MongoPoint = {
  label: string;
  connections: number;
  mem_resident: number;
  queries_s: number;
  writes_s: number;
  net_in_kb: number;
  net_out_kb: number;
};

function buildMongoSeries(snaps: MongoSnap[]): MongoPoint[] {
  if (snaps.length < 2) return snaps.map((s) => ({ label: s.label, connections: s.active_connections, mem_resident: s.mem_resident_mb, queries_s: 0, writes_s: 0, net_in_kb: 0, net_out_kb: 0 }));
  return snaps.slice(1).map((curr, i) => {
    const prev = snaps[i];
    const dt = Math.max((curr.ts - prev.ts) / 1000, 0.001);
    const queries_s = Math.max(0, (curr.op_query - prev.op_query) / dt);
    const writes_s = Math.max(0, ((curr.op_insert - prev.op_insert) + (curr.op_update - prev.op_update) + (curr.op_delete - prev.op_delete)) / dt);
    const net_in_kb = Math.max(0, (curr.net_bytes_in - prev.net_bytes_in) / dt / 1024);
    const net_out_kb = Math.max(0, (curr.net_bytes_out - prev.net_bytes_out) / dt / 1024);
    return {
      label: curr.label,
      connections: curr.active_connections,
      mem_resident: curr.mem_resident_mb,
      queries_s: Math.round(queries_s * 10) / 10,
      writes_s: Math.round(writes_s * 10) / 10,
      net_in_kb: Math.round(net_in_kb * 10) / 10,
      net_out_kb: Math.round(net_out_kb * 10) / 10,
    };
  });
}

function MongoMetricsView({ latest, series, collStats }: {
  latest: MongoSnap;
  series: MongoPoint[];
  collStats: { name: string; count: number }[];
}) {
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="grid shrink-0 grid-cols-4 gap-3">
        {latest.data_size_bytes != null && <StatCard label="Datos" value={fmtBytes(latest.data_size_bytes)} />}
        {latest.storage_size_bytes != null && <StatCard label="Almacenamiento" value={fmtBytes(latest.storage_size_bytes)} />}
        <StatCard label="Conexiones" value={String(latest.active_connections)} sub={`${latest.available_connections} disponibles`} />
        <StatCard label="Memoria RSS" value={`${latest.mem_resident_mb} MB`} sub={`${latest.mem_virtual_mb} MB virtual`} />
      </div>

      <div className="min-h-0 flex-1 grid grid-cols-2 gap-3">
        <ChartCard title="Conexiones activas">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="gMConn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#71717a" }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: "#71717a" }} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Area type="monotone" dataKey="connections" stroke="#8b5cf6" fill="url(#gMConn)" strokeWidth={1.5} dot={false} name="Conexiones" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Memoria RSS (MB)">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="gMem" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#71717a" }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: "#71717a" }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Area type="monotone" dataKey="mem_resident" stroke="#10b981" fill="url(#gMem)" strokeWidth={1.5} dot={false} name="RSS MB" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Queries + Escrituras / s">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#71717a" }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: "#71717a" }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="queries_s" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="Queries/s" />
              <Line type="monotone" dataKey="writes_s" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Writes/s" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Red KB/s">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#71717a" }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: "#71717a" }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="net_in_kb" stroke="#06b6d4" strokeWidth={1.5} dot={false} name="In KB/s" />
              <Line type="monotone" dataKey="net_out_kb" stroke="#ec4899" strokeWidth={1.5} dot={false} name="Out KB/s" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {collStats.length > 0 && (
        <div className="shrink-0">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Colecciones</p>
          <div className="max-h-44 overflow-auto rounded-lg border border-zinc-800">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="border-b border-zinc-800 bg-zinc-900/90">
                  <th className="px-3 py-2 text-left font-medium text-zinc-400">Colección</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-400">Documentos (~)</th>
                </tr>
              </thead>
              <tbody>
                {collStats.map((c, i) => (
                  <tr key={i} className="border-b border-zinc-800/40 hover:bg-zinc-900/40">
                    <td className="px-3 py-2 font-mono text-zinc-300">{c.name}</td>
                    <td className="px-3 py-2 text-right font-mono text-blue-300/80">{fmtNum(c.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Redis ────────────────────────────────────────────────────────────────────

type RedisSnap = {
  ts: number;
  label: string;
  connected_clients: number;
  blocked_clients: number;
  used_memory_bytes: number;
  used_memory_human: string;
  used_memory_rss_bytes: number;
  used_memory_peak_human: string;
  maxmemory_bytes: number;
  mem_fragmentation_ratio: number;
  total_commands_processed: number;
  total_connections_received: number;
  keyspace_hits: number;
  keyspace_misses: number;
  ops_per_sec: number;
  input_kbps: number;
  output_kbps: number;
  total_keys: number;
  redis_version: string;
  uptime_seconds: number;
  uptime_days: number;
  role: string;
  [k: string]: unknown;
};

type RedisPoint = {
  label: string;
  mem_mb: number;
  connections: number;
  cmds_s: number;
  hit_rate: number;
};

function buildRedisSeries(snaps: RedisSnap[]): RedisPoint[] {
  return snaps.slice(1).map((curr, i) => {
    const prev = snaps[i];
    const dt = Math.max((curr.ts - prev.ts) / 1000, 0.001);
    const cmds_s = Math.max(0, (curr.total_commands_processed - prev.total_commands_processed) / dt);
    const totalHits = curr.keyspace_hits + curr.keyspace_misses;
    const hit_rate = totalHits > 0 ? Math.round((curr.keyspace_hits / totalHits) * 1000) / 10 : 0;
    return {
      label: curr.label,
      mem_mb: Math.round((curr.used_memory_bytes / 1024 / 1024) * 10) / 10,
      connections: curr.connected_clients,
      cmds_s: Math.round(cmds_s * 10) / 10,
      hit_rate,
    };
  });
}

function RedisMetricsView({ latest, series }: { latest: RedisSnap; series: RedisPoint[] }) {
  const uptimeStr = latest.uptime_days > 0
    ? `${latest.uptime_days}d ${Math.floor((latest.uptime_seconds % 86400) / 3600)}h`
    : `${Math.floor(latest.uptime_seconds / 3600)}h ${Math.floor((latest.uptime_seconds % 3600) / 60)}m`;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="grid shrink-0 grid-cols-4 gap-3">
        <StatCard
          label="Redis"
          value={`v${latest.redis_version}`}
          sub={`uptime: ${uptimeStr} · ${latest.role}`}
        />
        <StatCard
          label="Memoria usada"
          value={latest.used_memory_human}
          sub={`pico: ${latest.used_memory_peak_human}`}
        />
        <StatCard label="Total claves" value={fmtNum(latest.total_keys)} />
        <StatCard
          label="Conexiones"
          value={String(latest.connected_clients)}
          sub={latest.blocked_clients > 0 ? `${latest.blocked_clients} bloqueadas` : undefined}
        />
      </div>

      <div className="min-h-0 flex-1 grid grid-cols-2 gap-3">
        <ChartCard title="Memoria usada (MB)">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="gRMem" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#71717a" }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: "#71717a" }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Area type="monotone" dataKey="mem_mb" stroke="#f59e0b" fill="url(#gRMem)" strokeWidth={1.5} dot={false} name="MB" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Conexiones activas">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="gRConn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#71717a" }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: "#71717a" }} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Area type="monotone" dataKey="connections" stroke="#8b5cf6" fill="url(#gRConn)" strokeWidth={1.5} dot={false} name="Conexiones" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Comandos / s">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="gRCmds" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#71717a" }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: "#71717a" }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Area type="monotone" dataKey="cmds_s" stroke="#3b82f6" fill="url(#gRCmds)" strokeWidth={1.5} dot={false} name="Cmds/s" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Keyspace hit rate (%)">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#71717a" }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#71717a" }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="hit_rate" stroke="#10b981" strokeWidth={1.5} dot={false} name="Hit %" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────

export function MetricsPanel({ connection, database }: { connection: Connection; database: string }) {
  const [snaps, setSnaps] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef(true);

  useEffect(() => {
    firstRef.current = true;
    setSnaps([]);
    setError(null);

    async function poll() {
      try {
        const data = await invoke<Record<string, unknown>>("get_db_metrics", { input: connection, database });
        const ts = Date.now();
        const label = new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        setSnaps((prev) => [...prev, { ...data, ts, label }].slice(-MAX_POINTS));
        setError(null);
      } catch (e: unknown) {
        setError(String(e));
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [connection, database]);

  const loading = snaps.length === 0 && !error;
  const latest = snaps[snaps.length - 1] ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-10 shrink-0 items-center gap-2 border-b px-4", sectionBorder)}>
        <span className="text-xs text-zinc-500">{database}</span>
        <span className="text-xs text-zinc-700">/</span>
        <span className="text-xs font-medium text-zinc-200">Métricas</span>
        {loading && <Loader2 className="ml-2 h-3.5 w-3.5 animate-spin text-zinc-500" />}
        {!loading && (
          <span className="ml-2 text-[10px] text-zinc-600">
            actualiza cada {POLL_MS / 1000}s · {snaps.length} puntos
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {error && <p className="p-4 text-xs text-red-400">{error}</p>}
        {loading && (
          <div className={cn("flex h-full items-center justify-center text-xs", mutedText)}>
            Cargando métricas...
          </div>
        )}
        {latest && !loading && (
          connection.plugin_id === "mongodb"
            ? <MongoMetricsView
                latest={latest as unknown as MongoSnap}
                series={buildMongoSeries(snaps as unknown as MongoSnap[])}
                collStats={(latest.collection_stats as { name: string; count: number }[]) ?? []}
              />
            : connection.plugin_id === "redis"
            ? <RedisMetricsView
                latest={latest as unknown as RedisSnap}
                series={buildRedisSeries(snaps as unknown as RedisSnap[])}
              />
            : <PgMetricsView
                latest={latest as unknown as PgSnap}
                series={buildPgSeries(snaps as unknown as PgSnap[])}
                topTables={(latest.top_tables as { schema: string; name: string; size: string; size_bytes: number }[]) ?? []}
              />
        )}
      </div>
    </div>
  );
}
