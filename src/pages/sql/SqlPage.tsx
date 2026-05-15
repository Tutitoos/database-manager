
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Table, X, Zap } from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useSessionsStore, type SqlSession } from "@/store/sessions";
import { mutedText, panel, sectionBorder, surface } from "@/lib/styles";
import type { Connection, TableResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AutocompleteInput, getWordAtPos, type GetSuggestions, type SuggestionItem, type SuggestionResult } from "@/components/autocomplete-input";

const PAGE_SIZE = 100;

type ExplainResult = {
  planning_ms: number;
  execution_ms: number;
  seq_scans: { relation: string; filter?: string }[];
  plan: unknown[];
};
type IndexInfo = { name: string; definition: string; primary: boolean; unique: boolean };

const SQL_VALUE_RE = /(\w+)\s*(?:=|!=|<>|>=|<=|>|<|(?:NOT\s+)?LIKE|(?:NOT\s+)?ILIKE)\s*((?:'[^']*|[\w.]*)?)$/i;

function extractColumnValues(result: { columns: string[]; rows: (string | number | boolean | null)[][] }): Map<string, SuggestionItem[]> {
  const sets = new Map<string, Set<string>>();
  for (const row of result.rows) {
    for (let i = 0; i < result.columns.length; i++) {
      const col = result.columns[i];
      const cell = row[i];
      if (cell === null || cell === undefined) continue;
      if (!sets.has(col)) sets.set(col, new Set());
      const s = sets.get(col)!;
      if (s.size >= 15) continue;
      const formatted = typeof cell === "string" ? `'${cell}'` : String(cell);
      s.add(formatted);
    }
  }
  const result2 = new Map<string, SuggestionItem[]>();
  for (const [col, vals] of sets.entries()) {
    result2.set(col, Array.from(vals).map((v) => ({ label: v })));
  }
  return result2;
}

function buildSqlGetSuggestions(
  columnItems: SuggestionItem[],
  columnValues: Map<string, SuggestionItem[]>,
  dynamicValues: Map<string, SuggestionItem[]>,
): GetSuggestions {
  return (value: string, cursorPos: number): SuggestionResult => {
    const before = value.slice(0, cursorPos);
    const m = SQL_VALUE_RE.exec(before);
    if (m) {
      const col = m[1];
      const partial = m[2];
      const valueStart = cursorPos - partial.length;
      const afterCursor = value.slice(cursorPos);
      const endMatch = afterCursor.match(/^[\w'.]+/);
      const replaceEnd = cursorPos + (endMatch ? endMatch[0].length : 0);
      const known = dynamicValues.get(col) ?? dynamicValues.get(col.toLowerCase())
        ?? columnValues.get(col) ?? columnValues.get(col.toLowerCase()) ?? [];
      const items = partial.length === 0
        ? known
        : known.filter((v) => v.label.toLowerCase().startsWith(partial.toLowerCase()) && v.label.toLowerCase() !== partial.toLowerCase());
      return { items: items.slice(0, 12), replaceStart: valueStart, replaceEnd };
    }
    const { word, start, end } = getWordAtPos(value, cursorPos);
    const items = word.length >= 1
      ? columnItems.filter(
          (s) =>
            s.label.toLowerCase().startsWith(word.toLowerCase()) &&
            s.label.toLowerCase() !== word.toLowerCase()
        )
      : [];
    return { items, replaceStart: start, replaceEnd: end };
  };
}

function SqlPage() {
  const [searchParams] = useSearchParams();
  const connectionId = Number(searchParams.get("id"));
  const db = searchParams.get("db") ?? "";
  const table = searchParams.get("table") ?? "";

  const [connection, setConnection] = useState<Connection | null>(null);
  const [result, setResult] = useState<TableResult | null>(null);
  const [prevQueryMs, setPrevQueryMs] = useState<number | null>(null);
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainData, setExplainData] = useState<ExplainResult | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [dynamicValues, setDynamicValues] = useState<Map<string, SuggestionItem[]>>(new Map());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { sessions, updateSession } = useSessionsStore();
  const tableKey = `${db}.${table}`;
  const storedFilter = (sessions[connectionId] as SqlSession | undefined)?.tableFilters?.[tableKey] ?? "";

  const [filterInput, setFilterInput] = useState(storedFilter);
  const [appliedFilter, setAppliedFilter] = useState(storedFilter);
  const [filterFocused, setFilterFocused] = useState(false);

  useEffect(() => {
    if (connectionId && db && table) {
      const current = (useSessionsStore.getState().sessions[connectionId] as SqlSession | undefined)?.tableFilters ?? {};
      updateSession(connectionId, { tableFilters: { ...current, [tableKey]: appliedFilter } });
    }
  }, [appliedFilter, connectionId]);

  // Cursor pagination — stack of cursors, undefined = first page
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined]);
  const [stackIdx, setStackIdx] = useState(0);
  const [fetchKey, setFetchKey] = useState(0);
  const requestGenRef = useRef(0);

  const activeCursor = cursorStack[stackIdx];
  const pageNum = stackIdx + 1;

  const columnSuggestions: SuggestionItem[] = useMemo(
    () => (result?.columns ?? []).map((col) => ({ label: col, hint: "col", color: "text-zinc-600" })),
    [result?.columns]
  );

  const columnValues = useMemo(
    () => result ? extractColumnValues(result) : new Map<string, SuggestionItem[]>(),
    [result]
  );

  const colMeta = useMemo(() => {
    const map = new Map<string, { primary: boolean; unique: boolean; indexed: boolean }>();
    for (const idx of indexes) {
      const m = /\(([^)]+)\)/.exec(idx.definition);
      if (!m) continue;
      const cols = m[1].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      for (const col of cols) {
        const prev = map.get(col) ?? { primary: false, unique: false, indexed: false };
        map.set(col, {
          primary: prev.primary || idx.primary,
          unique: prev.unique || idx.unique,
          indexed: true,
        });
      }
    }
    return map;
  }, [indexes]);

  const getSuggestions = useMemo(
    () => buildSqlGetSuggestions(columnSuggestions, columnValues, dynamicValues),
    [columnSuggestions, columnValues, dynamicValues]
  );

  useEffect(() => {
    invoke<Connection[]>("list_connections").then((all) => {
      setConnection(all.find((c) => c.id === connectionId) ?? null);
    });
  }, [connectionId]);

  useEffect(() => {
    const stored = (useSessionsStore.getState().sessions[connectionId] as SqlSession | undefined)?.tableFilters?.[`${db}.${table}`] ?? "";
    setCursorStack([undefined]);
    setStackIdx(0);
    setResult(null);
    setPrevQueryMs(null);
    setError(null);
    setFilterInput(stored);
    setAppliedFilter(stored);
    setDynamicValues(new Map());
    setExplainOpen(false);
    setExplainData(null);
    setIndexes([]);
  }, [db, table]);

  useEffect(() => {
    if (!connection || !table) return;
    const match = SQL_VALUE_RE.exec(filterInput);
    if (!match) return;
    const col = match[1];
    let partial = match[2] ?? "";
    if (partial.startsWith("'")) partial = partial.slice(1);
    if (partial.length < 1) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const vals = await invoke<string[]>("get_distinct_values", {
          input: connection, database: db, table, column: col, search: partial,
        });
        const items: SuggestionItem[] = vals.map((v) => ({ label: `'${v}'`, hint: "db" }));
        setDynamicValues((prev) => new Map(prev).set(col, items));
      } catch { /* silently ignore */ }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [filterInput, connection, db, table]);

  useEffect(() => {
    if (!connection || !db || !table) return;
    invoke<IndexInfo[]>("get_table_indexes", { input: connection, database: db, table })
      .then(setIndexes)
      .catch(() => setIndexes([]));
  }, [connection, db, table]);

  useEffect(() => {
    if (!connection || !db || !table) return;
    const gen = ++requestGenRef.current;
    setLoading(true);
    setError(null);
    invoke<TableResult>("get_table_data", {
      input: connection,
      database: db,
      table,
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
  }, [connection, db, table, appliedFilter, activeCursor, fetchKey]);

  function applyFilter() {
    setCursorStack([undefined]);
    setStackIdx(0);
    setAppliedFilter(filterInput.trim());
  }

  function clearFilter() {
    setCursorStack([undefined]);
    setStackIdx(0);
    setFilterInput("");
    setAppliedFilter("");
  }

  function nextPage() {
    if (loading) return;
    if (result?.pk_column) {
      if (!result.next_cursor) return;
      const newStack = [...cursorStack.slice(0, stackIdx + 1), result.next_cursor];
      setCursorStack(newStack);
      setStackIdx(newStack.length - 1);
    } else {
      if ((result?.rows.length ?? 0) < PAGE_SIZE) return;
      setStackIdx(stackIdx + 1);
    }
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

  async function runExplain() {
    if (!connection || !table) return;
    setExplainLoading(true);
    setExplainOpen(true);
    setExplainData(null);
    try {
      const [explain, idxs] = await Promise.all([
        invoke<ExplainResult>("explain_query", {
          input: connection, database: db, table,
          filter: appliedFilter, cursor: activeCursor ?? "",
          pkColumn: result?.pk_column ?? "",
        }),
        invoke<IndexInfo[]>("get_table_indexes", { input: connection, database: db, table }),
      ]);
      setExplainData(explain);
      setIndexes(idxs);
    } catch {
      setExplainData(null);
    } finally {
      setExplainLoading(false);
    }
  }

  function insertColumn(col: string) {
    setFilterInput((prev) => {
      const t = prev.trim();
      return t ? `${t} AND ${col} = ` : `${col} = `;
    });
  }

  if (!db || !table) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center bg-black/20 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.05)_0%,transparent_70%)]" />
        <div className="grid h-16 w-16 place-items-center rounded-2xl border border-white/5 bg-zinc-900/50 text-zinc-400 shadow-2xl backdrop-blur-sm relative">
          <Table className="h-8 w-8 text-blue-400/50" />
        </div>
        <h2 className="mt-6 text-base font-medium text-white relative">Selecciona una tabla</h2>
        <p className="mt-2 max-w-sm text-sm text-zinc-500 relative">
          Expande una base de datos en el panel izquierdo y haz clic en una tabla para ver sus datos.
        </p>
      </div>
    );
  }

  const canGoNext = result?.pk_column
    ? Boolean(result.next_cursor)
    : (result?.rows.length ?? 0) >= PAGE_SIZE;
  const canGoPrev = stackIdx > 0;

  return (
    <div className="flex h-full flex-col">
      {/* ── Filter area ── */}
      <div className={cn("relative shrink-0 border-b", sectionBorder)}>
        <div className="flex items-center gap-2 px-3 py-2">
          <span className={cn(
            "shrink-0 rounded-md bg-violet-500/15 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-widest text-violet-400 transition-opacity",
            loading && appliedFilter ? "animate-pulse" : ""
          )}>
            where
          </span>
          <div className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-zinc-950/60 px-2.5 py-1.5 transition-colors",
            filterFocused ? "border-zinc-600" : "border-zinc-800/80"
          )}>
            <AutocompleteInput
              value={filterInput}
              onChange={setFilterInput}
              onSubmit={applyFilter}
              getSuggestions={getSuggestions}
              placeholder="id > 100 AND active = true AND name = 'foo'"
              className="min-w-0 flex-1 bg-transparent font-mono text-xs text-zinc-300 placeholder-zinc-700 outline-none"
              onFocusChange={setFilterFocused}
            />
            {filterInput && (
              <button onClick={() => setFilterInput("")} className="shrink-0 text-zinc-600 transition-colors hover:text-zinc-400">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {appliedFilter && (
            <div className="flex shrink-0 items-center gap-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-1">
              <span className="max-w-32 truncate font-mono text-[10px] text-yellow-400">{appliedFilter}</span>
              <button onClick={clearFilter} className="shrink-0 text-yellow-600 transition-colors hover:text-yellow-300">
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
            <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] bg-violet-500/70" />
          </div>
        )}

        {/* Column chips */}
        {columnSuggestions.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto px-3 pb-2 scrollbar-none">
            <span className="shrink-0 text-[10px] text-zinc-700">Columnas:</span>
            {columnSuggestions.map(({ label }) => (
              <button
                key={label}
                onClick={() => insertColumn(label)}
                className="group/chip shrink-0 rounded-md border border-zinc-800/80 bg-zinc-900/60 px-2 py-0.5 font-mono text-[10px] text-zinc-500 transition-all hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Breadcrumb ── */}
      <div className={cn("flex h-10 shrink-0 items-center gap-2 border-b px-4", sectionBorder)}>
        <span className="text-xs text-zinc-500">{db}</span>
        <span className="text-xs text-zinc-700">/</span>
        <span className="text-xs font-medium text-zinc-200">{table}</span>
        {result && (
          <span className="ml-2 rounded-md bg-indigo-500/15 border border-indigo-500/30 px-2 py-0.5 text-[10px] font-bold text-indigo-400 shadow-sm shadow-indigo-900/20">
            Cargadas: {result.rows.length} | Total: {result.is_estimated ? "~" : ""}{result.total.toLocaleString()}
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
          {result && (
            <button
              onClick={runExplain}
              disabled={explainLoading}
              title="Explain query"
              className={cn(
                "flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-40",
                explainOpen
                  ? "border-violet-500/40 bg-violet-500/10 text-violet-400"
                  : "border-zinc-700/60 bg-zinc-800/60 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              )}
            >
              {explainLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
              Explain
            </button>
          )}
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

      {/* ── Explain panel ── */}
      {explainOpen && (
        <div className={cn("shrink-0 border-b", sectionBorder)}>
          <div className="flex items-center justify-between border-b border-zinc-800/50 px-4 py-2">
            <div className="flex items-center gap-3 text-[10px]">
              <span className="font-semibold uppercase tracking-wider text-zinc-500">Explain</span>
              {explainData && (
                <>
                  <span className="text-zinc-400">Planning <span className="text-white">{explainData.planning_ms.toFixed(2)}ms</span></span>
                  <span className="text-zinc-400">Execution <span className={cn("font-medium", explainData.execution_ms > 5000 ? "text-red-400" : explainData.execution_ms > 1000 ? "text-amber-400" : "text-emerald-400")}>{explainData.execution_ms >= 1000 ? `${(explainData.execution_ms / 1000).toFixed(2)}s` : `${explainData.execution_ms.toFixed(2)}ms`}</span></span>
                </>
              )}
              {explainLoading && <Loader2 className="h-3 w-3 animate-spin text-zinc-500" />}
            </div>
            <button onClick={() => setExplainOpen(false)} className="text-zinc-600 transition-colors hover:text-zinc-300">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {explainData && (
            <div className="flex gap-0 divide-x divide-zinc-800/50 overflow-x-auto">
              {/* Seq scan warnings */}
              {(explainData.seq_scans ?? []).length > 0 && (
                <div className="min-w-48 p-3">
                  <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-amber-500">⚠ Seq Scan</p>
                  {(explainData.seq_scans ?? []).map((s, i) => (
                    <div key={i} className="mb-1 text-[10px]">
                      <span className="font-mono text-amber-300">{s.relation}</span>
                      {s.filter && <span className="ml-1 text-zinc-500 truncate block max-w-48">{s.filter}</span>}
                    </div>
                  ))}
                </div>
              )}
              {(explainData.seq_scans ?? []).length === 0 && (
                <div className="min-w-36 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-emerald-500">✓ Index scan</p>
                  <p className="mt-1 text-[10px] text-zinc-500">No seq scans</p>
                </div>
              )}

              {/* Indexes */}
              <div className="min-w-0 flex-1 p-3">
                <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Índices ({indexes.length})</p>
                {indexes.length === 0 && <p className="text-[10px] text-zinc-600">Ninguno</p>}
                <div className="flex flex-wrap gap-1.5">
                  {indexes.map((idx) => (
                    <span key={idx.name} className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 font-mono text-[9px] text-zinc-400">
                      {idx.primary && <span className="rounded bg-blue-500/20 px-1 text-[8px] text-blue-400">PK</span>}
                      {idx.unique && !idx.primary && <span className="rounded bg-purple-500/20 px-1 text-[8px] text-purple-400">UQ</span>}
                      {idx.name}
                    </span>
                  ))}
                </div>
              </div>

              {/* Full plan */}
              <div className="p-3">
                <details>
                  <summary className="cursor-pointer text-[9px] font-semibold uppercase tracking-wider text-zinc-600 hover:text-zinc-400">Plan completo</summary>
                  <pre className="mt-2 max-h-48 max-w-sm overflow-auto rounded border border-zinc-800 bg-zinc-950 p-2 text-[9px] text-zinc-400">{JSON.stringify(explainData.plan, null, 2)}</pre>
                </details>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <div className="flex items-center gap-3 p-4 text-xs text-red-400">
            <span>{error}</span>
            <button
              onClick={retry}
              className="rounded border border-red-500/30 px-2 py-1 transition-colors hover:bg-red-500/10"
            >
              Reintentar
            </button>
          </div>
        )}
        {result && result.columns.length > 0 && (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10">
              <tr>
                {result.columns.map((col) => {
                  const meta = colMeta.get(col);
                  return (
                    <th
                      key={col}
                      className={cn(
                        "border-b border-r px-3 py-2 text-left font-medium whitespace-nowrap text-zinc-400",
                        sectionBorder,
                        panel
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        {meta?.primary && (
                          <span className="rounded px-1 py-px text-[8px] font-bold uppercase tracking-wider bg-blue-950 text-blue-300 border border-blue-800/60">PK</span>
                        )}
                        {!meta?.primary && meta?.unique && (
                          <span className="rounded px-1 py-px text-[8px] font-bold uppercase tracking-wider bg-purple-950 text-purple-300 border border-purple-800/60">UQ</span>
                        )}
                        {!meta?.primary && !meta?.unique && meta?.indexed && (
                          <span className="rounded px-1 py-px text-[8px] font-bold uppercase tracking-wider bg-zinc-800 text-zinc-400 border border-zinc-700/60">IDX</span>
                        )}
                        <span>{col}</span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i} className="border-b border-zinc-800/40 transition-colors hover:bg-zinc-900/50">
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={cn(
                        "border-r border-zinc-800/40 px-3 py-1.5",
                        typeof cell === "number" ? "text-right font-mono text-blue-300/80" : "text-zinc-300"
                      )}
                    >
                      {cell === null ? (
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-600">null</span>
                      ) : (
                        <span className="block max-w-70 truncate font-mono" title={String(cell)}>
                          {String(cell)}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && result && result.rows.length === 0 && (
          <div className={cn("p-8 text-center text-xs", mutedText)}>Sin datos</div>
        )}
      </div>

      {/* ── Pagination + Cancel ── */}
      <div className={cn("flex h-10 shrink-0 items-center justify-between border-t px-4", sectionBorder)}>
        <button
          onClick={prevPage}
          disabled={!canGoPrev || loading}
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
          <span className="text-xs text-zinc-500">
            Página {pageNum}
            {result && !result.is_estimated
              ? ` de ${Math.max(1, Math.ceil(result.total / PAGE_SIZE))}`
              : ""}
          </span>
        </div>

        <button
          onClick={nextPage}
          disabled={!canGoNext || loading}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-30"
        >
          Siguiente
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export default function SqlDataPage() {
  return (
    <Suspense>
      <SqlPage />
    </Suspense>
  );
}
