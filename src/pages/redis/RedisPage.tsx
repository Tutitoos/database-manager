
import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronRight, Copy, Key, Loader2, X } from "lucide-react";
import { Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { mutedText, sectionBorder, surface } from "@/lib/styles";
import type { Connection, KeyValue } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AutocompleteInput, type SuggestionItem } from "@/components/autocomplete-input";

// ── JSON tree ────────────────────────────────────────────────────────────────

type Parsed =
  | { kind: "null" }
  | { kind: "string"; v: string }
  | { kind: "number"; v: string }
  | { kind: "boolean"; v: string }
  | { kind: "object"; v: Record<string, unknown> }
  | { kind: "array"; v: unknown[] };

function parseVal(raw: unknown): Parsed {
  if (raw === null || raw === undefined) return { kind: "null" };
  if (typeof raw === "boolean") return { kind: "boolean", v: String(raw) };
  if (typeof raw === "number") return { kind: "number", v: String(raw) };
  if (Array.isArray(raw)) return { kind: "array", v: raw };
  if (typeof raw === "object") return { kind: "object", v: raw as Record<string, unknown> };
  return { kind: "string", v: String(raw) };
}

function tryJson(s: string): unknown | null {
  const t = s.trim();
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try { return JSON.parse(t); } catch { return null; }
  }
  return null;
}

const KIND_COLOR: Record<string, string> = {
  null: "text-zinc-500",
  string: "text-green-400",
  number: "text-blue-400",
  boolean: "text-blue-400",
  object: "text-zinc-500",
  array: "text-zinc-500",
};

function InlineVal({ p }: { p: Parsed }) {
  const c = KIND_COLOR[p.kind] ?? "text-zinc-300";
  switch (p.kind) {
    case "null": return <span className={c}>null</span>;
    case "string": return <span className={c}>&quot;{p.v}&quot;</span>;
    case "number":
    case "boolean": return <span className={c}>{p.v}</span>;
    case "object": return <span className={c}>{"{"}{Object.keys(p.v).length}{"}"}</span>;
    case "array": return <span className={c}>[{p.v.length}]</span>;
  }
}

function JsonRow({ fieldKey, raw, depth = 0 }: { fieldKey: string; raw: unknown; depth?: number }) {
  const [open, setOpen] = useState(false);
  const p = parseVal(raw);
  const nested = p.kind === "object" || p.kind === "array";
  const entries: [string, unknown][] = nested
    ? p.kind === "object"
      ? Object.entries(p.v)
      : (p.v as unknown[]).map((v, i) => [String(i), v])
    : [];

  return (
    <div style={{ paddingLeft: depth * 14 }}>
      <div className="flex items-center gap-1 py-px">
        {nested ? (
          <button onClick={() => setOpen((x) => !x)} className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors">
            <ChevronRight className={cn("h-3 w-3 transition-transform duration-100", open && "rotate-90")} />
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="text-zinc-300">{fieldKey}</span>
        <span className="text-zinc-600"> : </span>
        <InlineVal p={p} />
      </div>
      {nested && open && entries.map(([k, v]) => (
        <JsonRow key={k} fieldKey={k} raw={v} depth={depth + 1} />
      ))}
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  const p = parseVal(value);
  if (p.kind === "object") {
    return (
      <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3 font-mono text-xs">
        {Object.entries(p.v).map(([k, v]) => <JsonRow key={k} fieldKey={k} raw={v} />)}
      </div>
    );
  }
  if (p.kind === "array") {
    return (
      <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3 font-mono text-xs">
        {(p.v as unknown[]).map((v, i) => <JsonRow key={i} fieldKey={String(i)} raw={v} />)}
      </div>
    );
  }
  return (
    <pre className="whitespace-pre-wrap break-all rounded border border-zinc-800 bg-zinc-900/40 p-3 font-mono text-xs text-zinc-200">
      {String(value)}
    </pre>
  );
}

function SmartCell({ val }: { val: string }) {
  const [expanded, setExpanded] = useState(false);
  const parsed = tryJson(val);
  if (!parsed) return <span className="font-mono text-zinc-300">{val}</span>;
  return (
    <div>
      <button onClick={() => setExpanded((x) => !x)} className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 transition-colors">
        <ChevronRight className={cn("h-3 w-3 transition-transform duration-100", expanded && "rotate-90")} />
        <span className="font-mono text-[10px]">
          {Array.isArray(parsed) ? `Array(${(parsed as unknown[]).length})` : `Object(${Object.keys(parsed as object).length})`}
        </span>
      </button>
      {expanded && <div className="mt-1"><JsonBlock value={parsed} /></div>}
    </div>
  );
}

// ── Type badge colors ────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  string: "text-green-400 bg-green-400/10",
  list: "text-blue-400 bg-blue-400/10",
  hash: "text-yellow-400 bg-yellow-400/10",
  set: "text-purple-400 bg-purple-400/10",
  zset: "text-orange-400 bg-orange-400/10",
};

// ── Page ────────────────────────────────────────────────────────────────────

function RedisPage() {
  const [searchParams] = useSearchParams();
  const connectionId = Number(searchParams.get("id"));
  const db = searchParams.get("db") ?? "0";
  const key = searchParams.get("key") ?? "";

  const [connection, setConnection] = useState<Connection | null>(null);
  const [data, setData] = useState<KeyValue | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldFilter, setFieldFilter] = useState("");
  const [filterFocused, setFilterFocused] = useState(false);
  const [copied, setCopied] = useState(false);
  const [displayTtl, setDisplayTtl] = useState<number | null>(null);
  const ttlTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    invoke<Connection[]>("list_connections").then((all) => {
      setConnection(all.find((c) => c.id === connectionId) ?? null);
    });
  }, [connectionId]);

  useEffect(() => {
    setData(null);
    setError(null);
    setFieldFilter("");
  }, [key]);

  useEffect(() => {
    if (!connection || !key) return;
    setLoading(true);
    setError(null);
    invoke<KeyValue>("get_key_value", { input: connection, database: db, key })
      .then((kv) => {
        setData(kv);
        setDisplayTtl(kv.ttl);
        if (ttlTimerRef.current) clearInterval(ttlTimerRef.current);
        if (kv.ttl >= 0) {
          ttlTimerRef.current = setInterval(() => {
            setDisplayTtl((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
          }, 1000);
        }
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
    return () => { if (ttlTimerRef.current) clearInterval(ttlTimerRef.current); };
  }, [connection, db, key]);

  function copyValue() {
    if (!data) return;
    const text = typeof data.value === "string"
      ? data.value
      : JSON.stringify(data.value, null, 2);
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const filterSuggestions: SuggestionItem[] = useMemo(() => {
    if (!data) return [];
    if (data.key_type === "hash") {
      return Object.keys(data.value as Record<string, string>).map((f) => ({ label: f, hint: "field" }));
    }
    if (data.key_type === "set") {
      return (data.value as string[]).slice(0, 20).map((m) => ({ label: m }));
    }
    if (data.key_type === "zset") {
      return (data.value as Array<{ member: string; score: number }>)
        .slice(0, 20)
        .map(({ member }) => ({ label: member }));
    }
    return [];
  }, [data]);

  const showFilter = data && data.key_type !== "string";
  const deferredFilter = useDeferredValue(fieldFilter);
  const q = deferredFilter.toLowerCase();

  const filterPlaceholder =
    data?.key_type === "hash" ? "Buscar por campo o valor..." :
    data?.key_type === "list" ? "Buscar en valores..." :
    "Buscar miembro...";

  if (!key) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center bg-black/20 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.05)_0%,transparent_70%)]" />
        <div className="grid h-16 w-16 place-items-center rounded-2xl border border-white/5 bg-zinc-900/50 text-zinc-400 shadow-2xl backdrop-blur-sm relative">
          <Key className="h-8 w-8 text-blue-400/50" />
        </div>
        <h2 className="mt-6 text-base font-medium text-white relative">Selecciona una clave</h2>
        <p className="mt-2 max-w-sm text-sm text-zinc-500 relative">
          Selecciona una clave del panel izquierdo para explorar su contenido, tipo y tiempo de vida.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* ── Filter area ── */}
      {showFilter && (
        <div className="shrink-0 border-b border-white/5 bg-zinc-950/40 backdrop-blur-md">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-white/5 bg-black/40 px-3 py-1.5 transition-all shadow-inner focus-within:border-white/20 focus-within:ring-1 focus-within:ring-white/10">
              <AutocompleteInput
                value={fieldFilter}
                onChange={setFieldFilter}
                suggestions={filterSuggestions}
                placeholder={filterPlaceholder}
                className="min-w-0 flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 outline-none"
                onFocusChange={setFilterFocused}
              />
              {fieldFilter && (
                <button onClick={() => setFieldFilter("")} className="shrink-0 text-zinc-600 transition-colors hover:text-zinc-400">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {q && data && (
              <span className="shrink-0 rounded-full border border-white/5 bg-blue-500/10 text-blue-400 px-3 py-1 text-[11px] font-medium shadow-inner">
                <FilterCount data={data} q={q} /> resultados
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Key header ── */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/5 bg-zinc-950/40 px-5 backdrop-blur-md">
        <span className="truncate font-mono text-sm font-medium text-zinc-100">{key}</span>
        {data && (
          <>
            <span className={cn("shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", TYPE_COLORS[data.key_type] ?? "bg-zinc-800 text-zinc-400")}>
              {data.key_type}
            </span>
            <span className="shrink-0 rounded-full border border-white/5 bg-black/40 px-2.5 py-0.5 text-[11px] text-zinc-400 shadow-inner">
              TTL: {displayTtl !== null ? (displayTtl < 0 ? "∞" : `${displayTtl}s`) : (data.ttl < 0 ? "∞" : `${data.ttl}s`)}
            </span>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          {data && (
            <button
              onClick={copyValue}
              title="Copiar valor"
              className="flex items-center gap-1.5 rounded-md border border-white/5 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200 shadow-inner"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{copied ? "Copiado" : "Copiar"}</span>
            </button>
          )}
          {loading && <Loader2 className="h-4 w-4 animate-spin text-blue-400" />}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-5 bg-black/20">
        {error && <div className="text-xs text-red-400 mb-4 bg-red-500/10 border border-red-500/20 rounded p-3">{error}</div>}
        {data && <KeyValueDisplay data={data} q={q} />}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function FilterCount({ data, q }: { data: KeyValue; q: string }) {
  switch (data.key_type) {
    case "hash": {
      const entries = Object.entries(data.value as Record<string, string>);
      return <>{entries.filter(([f, v]) => f.toLowerCase().includes(q) || v.toLowerCase().includes(q)).length} / {entries.length}</>;
    }
    case "list": {
      const items = data.value as string[];
      return <>{items.filter((v) => v.toLowerCase().includes(q)).length} / {items.length}</>;
    }
    case "set": {
      const members = data.value as string[];
      return <>{members.filter((m) => m.toLowerCase().includes(q)).length} / {members.length}</>;
    }
    case "zset": {
      const pairs = data.value as Array<{ member: string; score: number }>;
      return <>{pairs.filter((p) => p.member.toLowerCase().includes(q) || String(p.score).includes(q)).length} / {pairs.length}</>;
    }
    default: return null;
  }
}

function KeyValueDisplay({ data, q }: { data: KeyValue; q: string }) {
  const thClass = "border-b border-r border-white/5 bg-white/[0.03] px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-500";
  const trClass = "border-b border-white/5 transition-colors hover:bg-white/[0.02]";
  const tdKey = "border-r border-white/5 px-4 py-2.5 font-mono text-xs text-zinc-200 align-top bg-white/[0.01]";

  switch (data.key_type) {
    case "string": {
      const raw = String(data.value);
      const parsed = tryJson(raw);
      return parsed
        ? <JsonBlock value={parsed} />
        : <pre className="whitespace-pre-wrap break-all rounded border border-zinc-800 bg-zinc-900/40 p-3 font-mono text-xs text-zinc-200">{raw}</pre>;
    }

    case "list": {
      const items = data.value as string[];
      const filtered = q ? items.filter((v) => v.toLowerCase().includes(q)) : items;
      return (
        <div className="overflow-hidden rounded-lg border border-white/5 bg-zinc-950/20 shadow-inner">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={cn(thClass, "w-16")}>Index</th>
                <th className={cn(thClass, "border-r-0")}>Value</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={items.indexOf(item)} className={trClass}>
                  <td className={cn(tdKey, "text-zinc-500 text-right")}>{items.indexOf(item)}</td>
                  <td className="px-4 py-2.5"><SmartCell val={item} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case "hash": {
      const map = data.value as Record<string, string>;
      const entries = Object.entries(map);
      const filtered = q
        ? entries.filter(([f, v]) => f.toLowerCase().includes(q) || v.toLowerCase().includes(q))
        : entries;
      return (
        <div className="overflow-hidden rounded-lg border border-white/5 bg-zinc-950/20 shadow-inner">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={cn(thClass, "w-40")}>Field</th>
                <th className={cn(thClass, "border-r-0")}>Value</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(([field, val]) => (
                <tr key={field} className={trClass}>
                  <td className={tdKey}>{field}</td>
                  <td className="px-4 py-2.5"><SmartCell val={val} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case "set": {
      const members = data.value as string[];
      const filtered = q ? members.filter((m) => m.toLowerCase().includes(q)) : members;
      return (
        <div className="flex flex-wrap gap-1.5">
          {filtered.map((m) => (
            <span key={m} className="rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-300">{m}</span>
          ))}
        </div>
      );
    }

    case "zset": {
      const pairs = data.value as Array<{ member: string; score: number }>;
      const filtered = q
        ? pairs.filter((p) => p.member.toLowerCase().includes(q) || String(p.score).includes(q))
        : pairs;
      return (
        <div className="overflow-hidden rounded-lg border border-white/5 bg-zinc-950/20 shadow-inner">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={cn(thClass, "w-24")}>Score</th>
                <th className={cn(thClass, "border-r-0")}>Member</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => (
                <tr key={i} className={trClass}>
                  <td className={cn(tdKey, "text-blue-300/80")}>{p.score}</td>
                  <td className="px-4 py-2.5"><SmartCell val={p.member} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    default:
      return (
        <pre className="whitespace-pre-wrap text-xs text-zinc-300">
          {JSON.stringify(data.value, null, 2)}
        </pre>
      );
  }
}

export default function RedisDataPage() {
  return (
    <Suspense>
      <RedisPage />
    </Suspense>
  );
}
