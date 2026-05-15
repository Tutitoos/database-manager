
import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronLeft, ChevronRight, FileText, Loader2, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useSessionsStore, type DocumentSession } from "@/store/sessions";
import { mutedText, sectionBorder, surface } from "@/lib/styles";
import type { Connection, DocumentResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AutocompleteInput, getWordAtPos, type GetSuggestions, type SuggestionItem, type SuggestionResult } from "@/components/autocomplete-input";

const PAGE_SIZE = 50;

// ── Extended JSON type parsing ──────────────────────────────────────────────

type ParsedValue =
  | { kind: "null" }
  | { kind: "string"; v: string }
  | { kind: "number"; v: string }
  | { kind: "boolean"; v: string }
  | { kind: "objectid"; v: string }
  | { kind: "date"; v: string }
  | { kind: "object"; v: Record<string, unknown> }
  | { kind: "array"; v: unknown[] };

function parse(raw: unknown): ParsedValue {
  if (raw === null || raw === undefined) return { kind: "null" };
  if (typeof raw === "string") return { kind: "string", v: raw };
  if (typeof raw === "number") return { kind: "number", v: String(raw) };
  if (typeof raw === "boolean") return { kind: "boolean", v: String(raw) };
  if (Array.isArray(raw)) return { kind: "array", v: raw };
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if ("$oid" in o) return { kind: "objectid", v: String(o.$oid) };
    if ("$date" in o) {
      const d = o.$date;
      if (typeof d === "string") return { kind: "date", v: d };
      if (typeof d === "object" && d && "$numberLong" in (d as Record<string, unknown>))
        return { kind: "date", v: new Date(Number((d as Record<string, unknown>).$numberLong)).toISOString() };
    }
    if ("$numberLong" in o) return { kind: "number", v: String(o.$numberLong) };
    if ("$numberDecimal" in o) return { kind: "number", v: String(o.$numberDecimal) };
    return { kind: "object", v: o };
  }
  return { kind: "string", v: String(raw) };
}

function isNested(p: ParsedValue): p is { kind: "object"; v: Record<string, unknown> } | { kind: "array"; v: unknown[] } {
  return p.kind === "object" || p.kind === "array";
}

const KIND_COLOR: Record<string, string> = {
  null: "text-zinc-600",
  string: "text-green-400",
  number: "text-blue-400",
  boolean: "text-blue-400",
  objectid: "text-red-400",
  date: "text-cyan-400",
  object: "text-zinc-500",
  array: "text-zinc-500",
};

const TYPE_HINT_COLOR: Record<string, string> = {
  null: "text-zinc-600",
  string: "text-green-600",
  number: "text-blue-600",
  boolean: "text-blue-600",
  objectid: "text-red-600",
  date: "text-cyan-600",
  object: "text-zinc-600",
  array: "text-zinc-600",
};

function InlineValue({ p }: { p: ParsedValue }) {
  const color = KIND_COLOR[p.kind] ?? "text-zinc-300";
  switch (p.kind) {
    case "null": return <span className={color}>null</span>;
    case "string": return <span className={color}>&quot;{p.v}&quot;</span>;
    case "number":
    case "boolean": return <span className={color}>{p.v}</span>;
    case "objectid": return <span className={color}>ObjectId(&apos;{p.v}&apos;)</span>;
    case "date": return <span className={color}>{p.v}</span>;
    case "object": return <span className={color}>Object</span>;
    case "array": return <span className={color}>Array({p.v.length})</span>;
  }
}

function FieldRow({ fieldKey, raw, depth = 0 }: { fieldKey: string; raw: unknown; depth?: number }) {
  const [open, setOpen] = useState(false);
  const p = parse(raw);
  const nested = isNested(p);
  const entries = nested
    ? p.kind === "object"
      ? Object.entries(p.v)
      : (p.v as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
    : [];

  return (
    <div style={{ paddingLeft: depth * 14 }}>
      <div className="flex items-center gap-1 py-px">
        {nested ? (
          <button onClick={() => setOpen((x) => !x)} className="shrink-0 text-zinc-600 transition-colors hover:text-zinc-300">
            <ChevronRight className={cn("h-3 w-3 transition-transform duration-100", open && "rotate-90")} />
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="text-zinc-200">{fieldKey}</span>
        <span className="text-zinc-600"> : </span>
        <InlineValue p={p} />
      </div>
      {nested && open && entries.map(([k, v]) => (
        <FieldRow key={k} fieldKey={k} raw={v} depth={depth + 1} />
      ))}
    </div>
  );
}

function DocumentCard({ doc }: { doc: Record<string, unknown> }) {
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const id = doc._id;
  const rest = Object.entries(doc).filter(([k]) => k !== "_id");

  function copyDoc() {
    navigator.clipboard.writeText(JSON.stringify(doc, null, 2)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group rounded border border-zinc-800 bg-zinc-950/60 font-mono text-xs">
      <div className="flex items-start gap-2 px-3 py-2">
        <button onClick={() => setCollapsed((x) => !x)} className="mt-0.5 shrink-0 text-zinc-600 transition-colors hover:text-zinc-300">
          <ChevronRight className={cn("h-3 w-3 transition-transform duration-100", !collapsed && "rotate-90")} />
        </button>
        <div className="min-w-0 flex-1">
          {id !== undefined && (
            <div className="flex items-center gap-1">
              <span className="text-zinc-200">_id</span>
              <span className="text-zinc-600"> : </span>
              <InlineValue p={parse(id)} />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300">
            <Pencil className="h-3 w-3" />
          </button>
          <button onClick={copyDoc} className="rounded p-1 transition-colors hover:bg-zinc-800" title="Copiar JSON">
            {copied
              ? <Check className="h-3 w-3 text-green-400" />
              : <svg viewBox="0 0 16 16" className="h-3 w-3 text-zinc-600 hover:text-zinc-300" fill="currentColor">
                  <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"/>
                  <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"/>
                </svg>
            }
          </button>
          <button className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-red-400">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      {!collapsed && rest.length > 0 && (
        <div className="border-t border-zinc-800/50 px-3 py-2">
          {rest.map(([key, value]) => (
            <FieldRow key={key} fieldKey={key} raw={value} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Field extraction ─────────────────────────────────────────────────────────

function collectPaths(
  obj: Record<string, unknown>,
  prefix: string,
  depth: number,
  out: Map<string, string>
) {
  if (depth > 4) return;
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const p = parse(val);
    if (!out.has(path)) out.set(path, p.kind);
    if (p.kind === "object") collectPaths(p.v, path, depth + 1, out);
  }
}

function extractFieldSuggestions(docs: Record<string, unknown>[]): SuggestionItem[] {
  const seen = new Map<string, string>();
  for (const doc of docs) collectPaths(doc, "", 0, seen);
  return Array.from(seen.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, kind]) => ({
      label,
      hint: kind,
      color: TYPE_HINT_COLOR[kind] ?? "text-zinc-600",
    }));
}

function collectValues(
  obj: Record<string, unknown>,
  prefix: string,
  depth: number,
  out: Map<string, Set<string>>
) {
  if (depth > 4) return;
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const p = parse(val);
    let formatted: string | null = null;
    switch (p.kind) {
      case "string": formatted = `"${p.v}"`; break;
      case "number": formatted = p.v; break;
      case "boolean": formatted = p.v; break;
      case "null": formatted = "null"; break;
    }
    if (formatted !== null) {
      if (!out.has(path)) out.set(path, new Set());
      const s = out.get(path)!;
      if (s.size < 15) s.add(formatted);
    }
    if (p.kind === "object") collectValues(p.v, path, depth + 1, out);
  }
}

function extractFieldValues(docs: Record<string, unknown>[]): Map<string, SuggestionItem[]> {
  const raw = new Map<string, Set<string>>();
  for (const doc of docs) collectValues(doc, "", 0, raw);
  const result = new Map<string, SuggestionItem[]>();
  for (const [field, values] of raw.entries()) {
    result.set(field, Array.from(values).map((v) => ({ label: v })));
  }
  return result;
}

const VALUE_CONTEXT_RE = /"([\w$.]+)"\s*:\s*((?:"[^"]*|[\w.]*)?)$/;

function buildGetSuggestions(
  fieldItems: SuggestionItem[],
  fieldValues: Map<string, SuggestionItem[]>
): GetSuggestions {
  return (value: string, cursorPos: number): SuggestionResult => {
    const before = value.slice(0, cursorPos);
    const m = VALUE_CONTEXT_RE.exec(before);
    if (m) {
      const field = m[1];
      const partial = m[2];
      const valueStart = cursorPos - partial.length;
      const { end } = getWordAtPos(value, cursorPos);
      const knownValues = fieldValues.get(field) ?? [];
      const items = partial.length === 0
        ? knownValues
        : knownValues.filter((v) => v.label.toLowerCase().startsWith(partial.toLowerCase()) && v.label.toLowerCase() !== partial.toLowerCase());
      return { items: items.slice(0, 8), replaceStart: valueStart, replaceEnd: end };
    }
    const { word, start, end } = getWordAtPos(value, cursorPos);
    const stripped = word.replace(/^"/, "").replace(/"$/, "");
    const items = stripped.length >= 1
      ? fieldItems.filter(
          (s) =>
            s.label.toLowerCase().startsWith(stripped.toLowerCase()) &&
            s.label.toLowerCase() !== stripped.toLowerCase()
        )
      : [];
    return { items, replaceStart: start, replaceEnd: end };
  };
}

// ── Page ────────────────────────────────────────────────────────────────────

function DocumentPage() {
  const [searchParams] = useSearchParams();
  const connectionId = Number(searchParams.get("id"));
  const db = searchParams.get("db") ?? "";
  const collection = searchParams.get("collection") ?? "";

  const [connection, setConnection] = useState<Connection | null>(null);
  const [result, setResult] = useState<DocumentResult | null>(null);
  const [prevQueryMs, setPrevQueryMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined]);
  const [stackIdx, setStackIdx] = useState(0);
  const [fetchKey, setFetchKey] = useState(0);
  const requestGenRef = useRef(0);

  const activeCursor = cursorStack[stackIdx];
  const pageNum = stackIdx + 1;

  const { sessions, updateSession } = useSessionsStore();
  const collectionKey = `${db}.${collection}`;
  const storedFilter = (sessions[connectionId] as DocumentSession | undefined)?.collectionFilters?.[collectionKey] ?? "";

  const [filterInput, setFilterInput] = useState(storedFilter);
  const [appliedFilter, setAppliedFilter] = useState(storedFilter);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [filterFocused, setFilterFocused] = useState(false);

  useEffect(() => {
    if (connectionId && db && collection) {
      const current = (useSessionsStore.getState().sessions[connectionId] as DocumentSession | undefined)?.collectionFilters ?? {};
      updateSession(connectionId, { collectionFilters: { ...current, [collectionKey]: appliedFilter } });
    }
  }, [appliedFilter, connectionId]);

  const fieldSuggestions = useMemo(
    () => extractFieldSuggestions(result?.documents ?? []),
    [result?.documents]
  );

  const fieldValues = useMemo(
    () => extractFieldValues(result?.documents ?? []),
    [result?.documents]
  );

  const getSuggestions = useMemo(
    () => buildGetSuggestions(fieldSuggestions, fieldValues),
    [fieldSuggestions, fieldValues]
  );

  useEffect(() => {
    invoke<Connection[]>("list_connections").then((all) => {
      setConnection(all.find((c) => c.id === connectionId) ?? null);
    });
  }, [connectionId]);

  useEffect(() => {
    const stored = (useSessionsStore.getState().sessions[connectionId] as DocumentSession | undefined)?.collectionFilters?.[`${db}.${collection}`] ?? "";
    setCursorStack([undefined]);
    setStackIdx(0);
    setResult(null);
    setPrevQueryMs(null);
    setError(null);
    setFilterInput(stored);
    setAppliedFilter(stored);
    setFilterError(null);
  }, [db, collection]);

  useEffect(() => {
    if (!connection || !db || !collection) return;
    const gen = ++requestGenRef.current;
    setLoading(true);
    setError(null);
    invoke<DocumentResult>("get_documents", {
      input: connection,
      database: db,
      collection,
      limit: PAGE_SIZE,
      offset: stackIdx * PAGE_SIZE,
      filter: appliedFilter,
      cursor: activeCursor ?? "",
    })
      .then((res) => {
        if (gen !== requestGenRef.current) return;
        setPrevQueryMs(result?.query_ms ?? null);
        setResult(res);
      })
      .catch((e: unknown) => {
        if (gen !== requestGenRef.current) return;
        setError(String(e));
      })
      .finally(() => {
        if (gen === requestGenRef.current) setLoading(false);
      });
  }, [connection, db, collection, appliedFilter, activeCursor, fetchKey]);

  function applyFilter() {
    const q = filterInput.trim();
    if (q === "") { setAppliedFilter(""); setFilterError(null); setCursorStack([undefined]); setStackIdx(0); return; }
    try { JSON.parse(q); } catch { setFilterError("JSON inválido"); return; }
    setFilterError(null);
    setCursorStack([undefined]);
    setStackIdx(0);
    setAppliedFilter(q);
  }

  function clearFilter() {
    setFilterInput("");
    setAppliedFilter("");
    setFilterError(null);
    setCursorStack([undefined]);
    setStackIdx(0);
  }

  function nextPage() {
    if (loading || !result?.next_cursor) return;
    const newStack = [...cursorStack.slice(0, stackIdx + 1), result.next_cursor];
    setCursorStack(newStack);
    setStackIdx(newStack.length - 1);
  }

  function prevPage() {
    if (loading || stackIdx === 0) return;
    setStackIdx(stackIdx - 1);
  }

  function cancelRequest() {
    requestGenRef.current++;
    setLoading(false);
  }

  function retry() {
    setError(null);
    setFetchKey((k) => k + 1);
  }

  function insertField(field: string) {
    const current = filterInput.trim();
    if (!current || current === "{}") {
      setFilterInput(`{ "${field}": }`);
    } else if (current.endsWith("}")) {
      setFilterInput(current.slice(0, -1).trimEnd() + `, "${field}": }`);
    } else {
      setFilterInput(current + `"${field}": `);
    }
  }

  if (!db || !collection) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center bg-black/20 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.05)_0%,transparent_70%)]" />
        <div className="grid h-16 w-16 w-16 place-items-center rounded-2xl border border-white/5 bg-zinc-900/50 text-zinc-400 shadow-2xl backdrop-blur-sm relative">
          <FileText className="h-8 w-8 text-blue-400/50" />
        </div>
        <h2 className="mt-6 text-base font-medium text-white relative">Selecciona una colección</h2>
        <p className="mt-2 max-w-sm text-sm text-zinc-500 relative">
          Expande una base de datos en el panel izquierdo y haz clic en una colección para ver sus documentos.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* ── Filter area ── */}
      <div className={cn("relative shrink-0 border-b", sectionBorder)}>
        <div className="flex items-center gap-2 px-3 py-2">
          <span className={cn(
            "shrink-0 rounded-md bg-blue-500/15 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-widest text-blue-400",
            loading && appliedFilter ? "animate-pulse" : ""
          )}>
            filter
          </span>
          <div className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-zinc-950/60 px-2.5 py-1.5 transition-colors",
            filterFocused ? "border-zinc-600" : "border-zinc-800/80",
            filterError ? "border-red-500/50" : ""
          )}>
            <AutocompleteInput
              value={filterInput}
              onChange={(v) => { setFilterInput(v); setFilterError(null); }}
              onSubmit={applyFilter}
              getSuggestions={getSuggestions}
              placeholder='{ "active": true, "plan_type": "server" }'
              className="min-w-0 flex-1 bg-transparent font-mono text-xs text-zinc-300 placeholder-zinc-700 outline-none"
              onFocusChange={setFilterFocused}
            />
            {filterInput && (
              <button onClick={() => { setFilterInput(""); setFilterError(null); }} className="shrink-0 text-zinc-600 transition-colors hover:text-zinc-400">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {appliedFilter && (
            <div className="flex shrink-0 items-center gap-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-1">
              <span className="text-[10px] font-medium text-yellow-400">activo</span>
              <button onClick={clearFilter} className="text-yellow-600 transition-colors hover:text-yellow-300">
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
          <button
            onClick={applyFilter}
            disabled={loading}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-[10px] font-medium text-zinc-300 transition-all hover:border-zinc-500 hover:bg-zinc-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading && appliedFilter ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {loading && appliedFilter ? "Buscando" : "Aplicar"}
          </button>
        </div>

        {loading && appliedFilter && (
          <div className="absolute bottom-0 left-0 h-px w-full overflow-hidden">
            <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] bg-blue-500/70" />
          </div>
        )}

        {/* Field chips */}
        {fieldSuggestions.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto px-3 pb-2 scrollbar-none">
            <span className="shrink-0 text-[10px] text-zinc-700">Campos:</span>
            {fieldSuggestions.map(({ label, hint, color }) => (
              <button
                key={label}
                onClick={() => insertField(label)}
                className="group/chip flex shrink-0 items-center gap-1 rounded-md border border-zinc-800/80 bg-zinc-900/60 px-2 py-0.5 transition-all hover:border-zinc-600 hover:bg-zinc-800"
              >
                <span className="font-mono text-[10px] text-zinc-500 transition-colors group-hover/chip:text-zinc-300">{label}</span>
                {hint && <span className={cn("text-[9px]", color)}>{hint}</span>}
              </button>
            ))}
          </div>
        )}

        {filterError && (
          <p className="px-3 pb-2 text-[10px] text-red-400">{filterError}</p>
        )}
      </div>

      {/* ── Breadcrumb ── */}
      <div className={cn("flex h-10 shrink-0 items-center gap-2 border-b px-4", sectionBorder)}>
        <span className="text-xs text-zinc-500">{db}</span>
        <span className="text-xs text-zinc-700">/</span>
        <span className="text-xs font-medium text-zinc-200">{collection}</span>
        {result && (
          <span className="ml-1 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
            {result.total.toLocaleString()} documentos
          </span>
        )}
        {result?.query_ms != null && !loading && (
          <div className="flex items-center gap-1.5">
            {prevQueryMs != null && prevQueryMs !== result.query_ms && (
              <span className="text-[10px] text-zinc-600 line-through">
                {prevQueryMs >= 1000 ? `${(prevQueryMs / 1000).toFixed(2)}s` : `${prevQueryMs}ms`}
              </span>
            )}
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
              {result.query_ms >= 1000 ? `${(result.query_ms / 1000).toFixed(2)}s` : `${result.query_ms}ms`}
            </span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />}
          <button
            onClick={retry}
            disabled={loading}
            title="Actualizar"
            className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-40"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-auto p-3">
        {error && (
          <div className="flex items-center gap-3 p-2 text-xs text-red-400">
            <span>{error}</span>
            <button
              onClick={retry}
              className="rounded border border-red-500/30 px-2 py-1 transition-colors hover:bg-red-500/10"
            >
              Reintentar
            </button>
          </div>
        )}
        {result?.documents.map((doc, i) => (
          <DocumentCard key={i} doc={doc} />
        ))}
        {!loading && result && result.documents.length === 0 && (
          <div className={cn("p-8 text-center text-xs", mutedText)}>Sin documentos</div>
        )}
      </div>

      <div className={cn("flex h-10 shrink-0 items-center justify-between border-t px-4", sectionBorder)}>
        <button
          onClick={prevPage}
          disabled={stackIdx === 0 || loading}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Anterior
        </button>

        <div className="flex items-center gap-2">
          {loading && (
            <button
              onClick={cancelRequest}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 px-2.5 py-1 text-[10px] text-zinc-400 transition-all hover:border-red-500/40 hover:text-red-400"
            >
              <X className="h-3 w-3" />
              Cancelar
            </button>
          )}
          <span className="text-xs text-zinc-500">Página {pageNum}</span>
        </div>

        <button
          onClick={nextPage}
          disabled={!result?.next_cursor || loading}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-30"
        >
          Siguiente
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export default function DocumentDataPage() {
  return (
    <Suspense>
      <DocumentPage />
    </Suspense>
  );
}
