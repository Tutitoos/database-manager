
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, Copy, Download, Loader2, Pencil, Plus, RefreshCw, Table, Trash2, X, XCircle, Zap } from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "@/lib/router-compat";
import { useSessionsStore, type SqlSession } from "@/store/sessions";
import { mutedText, panel, sectionBorder, surface } from "@/lib/styles";
import type { Connection, TableResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AutocompleteInput, getWordAtPos, type GetSuggestions, type SuggestionItem, type SuggestionResult } from "@/components/autocomplete-input";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/code-editor";
import { QueryTimings, type TimingEntry } from "@/components/query-timings";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Eye } from "lucide-react";

const PAGE_SIZE = 100;

const SQL_TOOL_BTN =
  "inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md border border-border-subtle bg-surface-elevated px-3 text-body font-medium text-text transition-colors duration-150 hover:border-border-strong hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-50";

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
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [prevQueryMs, setPrevQueryMs] = useState<number | null>(null);
  const [renderMs, setRenderMs] = useState<number | null>(null);
  const [timingHistory, setTimingHistory] = useState<TimingEntry[]>([]);
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
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [colMenuOpen, setColMenuOpen] = useState(false);
  type SqlRow = (string | number | boolean | null)[];
  const tableColumns = useMemo<ColumnDef<SqlRow>[]>(() => {
    if (!result) return [];
    return result.columns.map<ColumnDef<SqlRow>>((col, idx) => ({
      id: col,
      header: col,
      accessorFn: (row) => row[idx],
      size: 180,
      minSize: 80,
      enableSorting: true,
    }));
  }, [result?.columns]);
  const tableInstance = useReactTable<SqlRow>({
    data: result?.rows ?? [],
    columns: tableColumns,
    state: { sorting, columnVisibility, columnSizing },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const [rowEditor, setRowEditor] = useState<{
    pkValue: string | number;
    json: string;
    saving: boolean;
    error: string | null;
  } | null>(null);
  const [rowDelete, setRowDelete] = useState<{ pkValue: string | number } | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [selectedRowIdx, setSelectedRowIdx] = useState<number | null>(null);

  function rowToRecord(row: (string | number | boolean | null)[]): Record<string, unknown> {
    const cols = result?.columns ?? [];
    const out: Record<string, unknown> = {};
    cols.forEach((c, i) => {
      out[c] = row[i] ?? null;
    });
    return out;
  }

  function openRowInsert() {
    if (!result) return;
    // Seed the editor with an empty record: column names as keys, null values.
    // Use a sentinel pkValue so the save path knows it's an insert (delete_row
    // would never match). Save handler treats `pkValue === ""` as INSERT.
    const obj: Record<string, unknown> = {};
    for (const c of result.columns) obj[c] = null;
    setRowEditor({
      pkValue: "",
      json: JSON.stringify(obj, null, 2),
      saving: false,
      error: null,
    });
  }

  /** Serialize the current page rows to CSV and trigger a download. */
  function exportCsv() {
    if (!result) return;
    const escape = (v: unknown): string => {
      if (v == null) return "";
      const s = typeof v === "string" ? v : JSON.stringify(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = result.columns.map(escape).join(",");
    const body = result.rows
      .map((row) => result.columns.map((_, i) => escape(row[i])).join(","))
      .join("\n");
    const csv = `${header}\n${body}\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${table}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openRowEdit(row: (string | number | boolean | null)[]) {
    if (!result?.pk_column) return;
    const obj = rowToRecord(row);
    const pkColIdx = result.columns.indexOf(result.pk_column);
    const pkValue = row[pkColIdx] as string | number;
    setRowEditor({
      pkValue,
      json: JSON.stringify(obj, null, 2),
      saving: false,
      error: null,
    });
  }

  function copyRowJson(row: (string | number | boolean | null)[]) {
    navigator.clipboard.writeText(JSON.stringify(rowToRecord(row), null, 2)).catch(() => undefined);
    setActionStatus("Fila copiada");
    setTimeout(() => setActionStatus(null), 1500);
  }

  async function performRowDelete() {
    if (!connection || !rowDelete || !result?.pk_column) return;
    try {
      await invoke("delete_row", {
        input: connection,
        database: db,
        table,
        pkColumn: result.pk_column,
        pkValue: rowDelete.pkValue,
      });
      setRowDelete(null);
      setActionStatus("Fila eliminada");
      setTimeout(() => setActionStatus(null), 1500);
      retry();
    } catch (e) {
      setRowDelete(null);
      setError(String(e));
    }
  }

  async function performRowSave() {
    if (!connection || !rowEditor || !result?.pk_column) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rowEditor.json);
    } catch {
      setRowEditor({ ...rowEditor, error: "JSON inválido" });
      return;
    }
    setRowEditor({ ...rowEditor, saving: true, error: null });
    try {
      await invoke("update_row", {
        input: connection,
        database: db,
        table,
        pkColumn: result.pk_column,
        pkValue: rowEditor.pkValue,
        values: parsed,
      });
      const wasInsert = rowEditor.pkValue === "";
      setRowEditor(null);
      setActionStatus(wasInsert ? "Fila insertada" : "Fila actualizada");
      setTimeout(() => setActionStatus(null), 1500);
      retry();
    } catch (e) {
      setRowEditor({ ...rowEditor, saving: false, error: String(e) });
    }
  }

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
    () => (result?.columns ?? []).map((col) => ({ label: col, hint: "col", color: "text-text-faint" })),
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
    setSelectedRowIdx(null);
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
    const t0 = performance.now();
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
        const totalMs = performance.now() - t0;
        const queryMs = res.query_ms ?? 0;
        const rMs = Math.max(0, totalMs - queryMs);
        setPrevQueryMs(result?.query_ms ?? null);
        setResult(res);
        setSelectedRowIdx(null);
        setLastLoadedAt(new Date());
        setRenderMs(rMs);
        setTimingHistory((prev) => {
          const next = [
            ...prev,
            { queryMs, renderMs: rMs, totalMs, at: Date.now(), label: `${table} · pg ${stackIdx + 1}` },
          ];
          return next.slice(-20);
        });
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
        <div className="grid h-16 w-16 place-items-center rounded-2xl border border-border-subtle bg-surface-elevated/50 text-text-muted shadow-2xl backdrop-blur-sm relative">
          <Table className="h-8 w-8 text-blue-400/50" />
        </div>
        <h2 className="mt-6 text-h2 font-medium text-text relative">Selecciona una tabla</h2>
        <p className="mt-2 max-w-sm text-h3 text-text-faint relative">
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
        <div className="flex items-center gap-2 px-4 py-2.5">
          <span className="text-overline shrink-0">where</span>
          <div className={cn(
            "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-surface-sunken px-3 transition-colors",
            filterFocused ? "border-border-focus ring-1 ring-accent-ring" : "border-border-subtle"
          )}>
            <AutocompleteInput
              value={filterInput}
              onChange={setFilterInput}
              onSubmit={applyFilter}
              getSuggestions={getSuggestions}
              placeholder="id > 100 AND active = true AND name = 'foo'"
              className="min-w-0 flex-1 bg-transparent font-mono text-body text-text placeholder:text-text-faint outline-none"
              onFocusChange={setFilterFocused}
            />
            {filterInput && (
              <button onClick={() => setFilterInput("")} className="shrink-0 text-text-faint transition-colors hover:text-text">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {appliedFilter && appliedFilter !== filterInput && (
            <div className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-accent/40 bg-accent-soft px-2.5">
              <span className="text-overline text-accent/70">Activo</span>
              <span className="max-w-32 truncate font-mono text-body text-accent">{appliedFilter}</span>
              <button onClick={clearFilter} className="shrink-0 text-accent transition-opacity hover:opacity-70" title="Limpiar filtro">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <Button
            onClick={applyFilter}
            disabled={loading}
            variant="primary"
            size="md"
          >
            {loading && appliedFilter ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {loading && appliedFilter ? "Buscando" : "Aplicar"}
          </Button>
        </div>

        {loading && appliedFilter && (
          <div className="absolute bottom-0 left-0 h-px w-full overflow-hidden">
            <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] bg-accent" />
          </div>
        )}

        {/* Column chips */}
        {columnSuggestions.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto px-4 pb-2.5 scrollbar-none">
            <span className="text-overline shrink-0 pr-1">Columnas</span>
            <span className="mx-1 h-3 w-px shrink-0 bg-border-subtle" />
            {columnSuggestions.map(({ label }) => {
              const meta = colMeta.get(label);
              const stripeCls = meta?.primary
                ? "bg-accent"
                : meta?.unique
                  ? "bg-info"
                  : meta?.indexed
                    ? "bg-text-faint"
                    : "";
              const titleSuffix = meta?.primary
                ? " · Primary Key"
                : meta?.unique
                  ? " · Unique"
                  : meta?.indexed
                    ? " · Indexed"
                    : "";
              return (
                <button
                  key={label}
                  onClick={() => insertColumn(label)}
                  title={`${label}${titleSuffix}`}
                  className="group/chip relative inline-flex h-7 shrink-0 items-center gap-1.5 overflow-hidden rounded-md border border-border-subtle bg-surface-elevated pl-3 pr-2.5 transition-colors hover:border-border-strong hover:bg-surface-hover"
                >
                  {stripeCls && (
                    <span className={cn("absolute left-0 top-0 h-full w-1", stripeCls)} aria-hidden />
                  )}
                  <span className="text-body-mono text-text">{label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Stats + actions toolbar ── */}
      {!error && !loading && result && (
      <div className={cn("flex h-12 shrink-0 items-center gap-3 border-b px-4", sectionBorder)}>
        {result && (
          <div className="flex items-baseline gap-1 text-body">
            <span className="font-mono font-semibold text-text">{result.rows.length}</span>
            {result.total >= 0 && (
              <span className="font-mono text-text-faint">
                / {result.is_estimated ? "~" : ""}{result.total.toLocaleString()}
              </span>
            )}
            <span className="ml-1 text-text-muted">filas</span>
          </div>
        )}
        {result?.query_ms != null && !loading && (
          <>
            <span className="text-text-faint">·</span>
            <QueryTimings
              queryMs={result.query_ms}
              renderMs={renderMs}
              history={timingHistory}
            />
          </>
        )}
        {result && selectedRowIdx != null && result.rows[selectedRowIdx] && (
          <>
            <span className="text-text-faint">·</span>
            <div className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-accent/40 bg-accent-soft pl-2.5 pr-1 text-body">
              <span className="font-medium text-accent">Fila {selectedRowIdx + 1}</span>
              <span className="mx-1 h-4 w-px bg-accent/30" />
              <button
                onClick={() => copyRowJson(result.rows[selectedRowIdx])}
                title="Copiar fila JSON"
                className="inline-flex h-6 items-center gap-1.5 rounded px-2 text-body font-medium text-text transition-colors hover:bg-surface-hover"
              >
                <Copy className="h-3.5 w-3.5" />
                Copiar
              </button>
              <button
                onClick={() => openRowEdit(result.rows[selectedRowIdx])}
                disabled={!result.pk_column}
                title={result.pk_column ? "Editar fila" : "Sin PK no editable"}
                className="inline-flex h-6 items-center gap-1.5 rounded px-2 text-body font-medium text-text transition-colors hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-50"
              >
                <Pencil className="h-3.5 w-3.5" />
                Editar
              </button>
              <button
                onClick={() => {
                  if (!result.pk_column) return;
                  const pkIdx = result.columns.indexOf(result.pk_column);
                  setRowDelete({ pkValue: result.rows[selectedRowIdx][pkIdx] as string | number });
                }}
                disabled={!result.pk_column}
                title={result.pk_column ? "Eliminar fila" : "Sin PK no eliminable"}
                className="inline-flex h-6 items-center gap-1.5 rounded px-2 text-body font-medium text-danger transition-colors hover:bg-danger-soft disabled:pointer-events-none disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Eliminar
              </button>
              <button
                onClick={() => setSelectedRowIdx(null)}
                title="Deseleccionar"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          {loading && <Loader2 className="h-4 w-4 animate-spin text-text-faint" />}
          {result && (
            <>
              <button onClick={openRowInsert} title="Insertar fila" className={SQL_TOOL_BTN}>
                <Plus className="h-3.5 w-3.5" />
                Insertar
              </button>
              <button onClick={exportCsv} title="Exportar página actual a CSV" className={SQL_TOOL_BTN}>
                <Download className="h-3.5 w-3.5" />
                CSV
              </button>
              <button
                onClick={runExplain}
                disabled={explainLoading}
                title="Explain query"
                className={cn(
                  SQL_TOOL_BTN,
                  explainOpen && "border-accent/40 bg-accent-soft text-accent hover:bg-accent-soft",
                )}
              >
                {explainLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                Explain
              </button>
            </>
          )}
          {result && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setColMenuOpen((v) => !v)}
                title="Mostrar/ocultar columnas"
                className={cn(SQL_TOOL_BTN, "w-8 px-0", colMenuOpen && "border-accent/40 bg-accent-soft text-accent")}
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
              {colMenuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setColMenuOpen(false)} />
                  <div className="absolute right-0 top-full z-40 mt-1 max-h-72 w-56 overflow-auto rounded-md border border-border-subtle bg-surface-overlay p-2 shadow-xl">
                    <p className="text-overline mb-1">Columnas</p>
                    {tableInstance.getAllLeafColumns().map((c) => (
                      <label
                        key={c.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-caption text-text hover:bg-surface-hover"
                      >
                        <input
                          type="checkbox"
                          checked={c.getIsVisible()}
                          onChange={c.getToggleVisibilityHandler()}
                          className="h-3 w-3 accent-accent"
                        />
                        <span className="truncate font-mono">{c.id}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <button
            onClick={retry}
            disabled={loading}
            title={
              lastLoadedAt
                ? `Actualizar · última carga ${lastLoadedAt.toLocaleTimeString()}`
                : "Actualizar"
            }
            className={cn(SQL_TOOL_BTN, "w-8 px-0")}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      )}

      {/* ── Explain panel ── */}
      {explainOpen && (
        <div className={cn("shrink-0 border-b", sectionBorder)}>
          <div className="flex items-center justify-between border-b border-border-subtle/50 px-4 py-2">
            <div className="flex items-center gap-3 text-[10px]">
              <span className="font-semibold uppercase tracking-wider text-text-faint">Explain</span>
              {explainData && (
                <>
                  <span className="text-text-muted">Planning <span className="text-text">{explainData.planning_ms.toFixed(2)}ms</span></span>
                  <span className="text-text-muted">Execution <span className={cn("font-medium", explainData.execution_ms > 5000 ? "text-red-400" : explainData.execution_ms > 1000 ? "text-amber-400" : "text-emerald-400")}>{explainData.execution_ms >= 1000 ? `${(explainData.execution_ms / 1000).toFixed(2)}s` : `${explainData.execution_ms.toFixed(2)}ms`}</span></span>
                </>
              )}
              {explainLoading && <Loader2 className="h-3 w-3 animate-spin text-text-faint" />}
            </div>
            <button onClick={() => setExplainOpen(false)} className="text-text-faint transition-colors hover:text-text">
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
                      {s.filter && <span className="ml-1 text-text-faint truncate block max-w-48">{s.filter}</span>}
                    </div>
                  ))}
                </div>
              )}
              {(explainData.seq_scans ?? []).length === 0 && (
                <div className="min-w-36 p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-emerald-500">✓ Index scan</p>
                  <p className="mt-1 text-[10px] text-text-faint">No seq scans</p>
                </div>
              )}

              {/* Indexes */}
              <div className="min-w-0 flex-1 p-3">
                <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-text-faint">Índices ({indexes.length})</p>
                {indexes.length === 0 && <p className="text-[10px] text-text-faint">Ninguno</p>}
                <div className="flex flex-wrap gap-1.5">
                  {indexes.map((idx) => (
                    <span key={idx.name} className="flex items-center gap-1 rounded border border-border-subtle bg-surface-elevated/60 px-2 py-0.5 font-mono text-[9px] text-text-muted">
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
                  <summary className="cursor-pointer text-[9px] font-semibold uppercase tracking-wider text-text-faint hover:text-text-muted">Plan completo</summary>
                  <pre className="mt-2 max-h-48 max-w-sm overflow-auto rounded border border-border-subtle bg-surface p-2 text-[9px] text-text-muted">{JSON.stringify(explainData.plan, null, 2)}</pre>
                </details>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <div className="mx-auto mt-4 flex w-full max-w-3xl items-start gap-3 rounded-md border border-danger/40 bg-danger-soft p-4">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-danger">Error al ejecutar la consulta</p>
              <p className="text-body-mono mt-1 break-all text-danger/80">{error}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={retry}>
              Reintentar
            </Button>
          </div>
        )}
        {loading && !error && (
          <SqlTableSkeleton columns={result?.columns ?? null} />
        )}
        {!loading && !error && result && result.columns.length > 0 && (
          <div>
            <table className="w-full border-collapse text-body" style={{ minWidth: tableInstance.getTotalSize() }}>
              <thead className="sticky top-0 z-10">
                {tableInstance.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => {
                      const meta = colMeta.get(h.column.id);
                      const sortDir = h.column.getIsSorted();
                      return (
                        <th
                          key={h.id}
                          colSpan={h.colSpan}
                          style={{ width: h.getSize() }}
                          className={cn(
                            "group/h relative border-b border-r px-3 py-2 text-left font-medium whitespace-nowrap text-text-muted select-none",
                            sectionBorder,
                            panel,
                          )}
                        >
                          <div
                            className="flex cursor-pointer items-center gap-1.5"
                            onClick={h.column.getToggleSortingHandler()}
                          >
                            {meta?.primary && (
                              <span className="text-tiny rounded border border-accent/40 bg-accent-soft px-1 py-px font-bold uppercase tracking-wider text-accent">PK</span>
                            )}
                            {!meta?.primary && meta?.unique && (
                              <span className="text-tiny rounded border border-info/40 bg-info-soft px-1 py-px font-bold uppercase tracking-wider text-info">UQ</span>
                            )}
                            {!meta?.primary && !meta?.unique && meta?.indexed && (
                              <span className="text-tiny rounded border border-border-strong/60 bg-surface-sunken px-1 py-px font-bold uppercase tracking-wider text-text-muted">IDX</span>
                            )}
                            <span className="truncate">{flexRender(h.column.columnDef.header, h.getContext())}</span>
                            {sortDir === "asc" ? (
                              <ArrowUp className="h-3 w-3 text-accent" />
                            ) : sortDir === "desc" ? (
                              <ArrowDown className="h-3 w-3 text-accent" />
                            ) : (
                              <ArrowUpDown className="h-3 w-3 text-text-faint opacity-0 group-hover/h:opacity-100" />
                            )}
                          </div>
                          {h.column.getCanResize() && (
                            <div
                              onMouseDown={h.getResizeHandler()}
                              onTouchStart={h.getResizeHandler()}
                              className={cn(
                                "absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none touch-none",
                                h.column.getIsResizing() ? "bg-accent" : "hover:bg-surface-active",
                              )}
                            />
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {tableInstance.getRowModel().rows.map((tableRow) => {
                  const row = tableRow.original;
                  const rowIdx = tableRow.index;
                  const isSelected = selectedRowIdx === rowIdx;
                  return (
                    <tr
                      key={tableRow.id}
                      aria-selected={isSelected}
                      onClick={() => setSelectedRowIdx((cur) => (cur === rowIdx ? null : rowIdx))}
                      className={cn(
                        "group cursor-pointer border-b border-border-subtle transition-colors",
                        isSelected
                          ? "bg-accent-soft hover:bg-accent-soft/80"
                          : "hover:bg-surface-elevated/50",
                      )}
                    >
                      {tableRow.getVisibleCells().map((cellCtx) => {
                        const cell = cellCtx.getValue() as string | number | boolean | null;
                        return (
                          <td
                            key={cellCtx.id}
                            style={{ width: cellCtx.column.getSize() }}
                            className={cn(
                              "border-r border-border-subtle px-3 py-1.5",
                              typeof cell === "number" ? "text-right font-mono text-accent" : "text-text",
                            )}
                          >
                            {cell === null ? (
                              <span className="text-caption rounded bg-surface-sunken px-1.5 py-0.5 text-text-faint">null</span>
                            ) : (
                              <span className="block max-w-70 truncate font-mono" title={String(cell)}>
                                {String(cell)}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!error && !loading && result && result.rows.length === 0 && (
          <div className={cn("p-8 text-center text-body", mutedText)}>Sin datos</div>
        )}
      </div>

      {/* ── Pagination + Cancel ── */}
      {/* Single-page guard: when total rows fit in one page and we know the
          total exactly, hide the footer. Keep showing it while loading so the
          cancel button stays reachable. */}
      {!error && (loading ||
        canGoPrev ||
        canGoNext ||
        (result?.is_estimated ?? false) ||
        (result ? result.total > PAGE_SIZE : false)) && (
        <div className={cn("flex h-10 shrink-0 items-center justify-between border-t px-4", sectionBorder)}>
          <button
            onClick={prevPage}
            disabled={!canGoPrev || loading}
            className="flex items-center gap-1 rounded px-2 py-1 text-body text-text-muted transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Anterior
          </button>

          <div className="flex items-center gap-2">
            {loading && (
              <button
                onClick={cancelRequest}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-subtle bg-surface-elevated px-2 text-caption text-text-muted transition-colors hover:border-danger/40 hover:bg-danger-soft hover:text-danger"
              >
                <X className="h-3 w-3" />
                Cancelar
              </button>
            )}
            <span className="text-body text-text-faint">
              Página {pageNum}
              {result && !result.is_estimated
                ? ` de ${Math.max(1, Math.ceil(result.total / PAGE_SIZE))}`
                : ""}
            </span>
          </div>

          <button
            onClick={nextPage}
            disabled={!canGoNext || loading}
            className="flex items-center gap-1 rounded px-2 py-1 text-body text-text-muted transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-30"
          >
            Siguiente
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {rowEditor && (
        <Modal onClose={() => !rowEditor.saving && setRowEditor(null)}>
          <div className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-lg border border-border-subtle bg-surface-overlay shadow-xl">
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
              <h2 className="text-h3 font-medium text-text">
                {rowEditor.pkValue === "" ? "Insertar fila" : `Editar fila — PK ${String(rowEditor.pkValue)}`}
              </h2>
              <button className="rounded p-1 text-text-faint hover:bg-surface-hover hover:text-text" onClick={() => setRowEditor(null)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="min-h-[50vh] flex-1 overflow-auto bg-surface">
              <CodeEditor
                lang="json"
                value={rowEditor.json}
                onChange={(v) => setRowEditor({ ...rowEditor, json: v, error: null })}
                minHeight="50vh"
              />
            </div>
            {rowEditor.error && (
              <div className="border-t border-danger/40 bg-danger-soft px-4 py-2 text-body text-danger">{rowEditor.error}</div>
            )}
            <div className="flex justify-end gap-2 border-t border-border-subtle px-4 py-3">
              <Button variant="secondary" size="sm" onClick={() => setRowEditor(null)} disabled={rowEditor.saving}>
                Cancelar
              </Button>
              <Button variant="primary" size="sm" onClick={performRowSave} disabled={rowEditor.saving}>
                {rowEditor.saving ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {rowDelete && (
        <Modal onClose={() => setRowDelete(null)}>
          <div className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-overlay p-5 shadow-xl">
            <h2 className="text-h3 font-medium text-text">¿Eliminar fila?</h2>
            <p className="text-body-mono mt-2 break-all rounded bg-surface-elevated px-2 py-1 text-text">PK: {String(rowDelete.pkValue)}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setRowDelete(null)}>
                Cancelar
              </Button>
              <Button variant="danger" size="sm" onClick={performRowDelete}>
                Eliminar
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {actionStatus && (
        <div className="text-body fixed bottom-5 right-5 rounded-md border border-success/40 bg-success-soft px-3 py-2 text-success shadow-xl">
          {actionStatus}
        </div>
      )}
    </div>
  );
}

function SqlTableSkeleton({ columns }: { columns: string[] | null }) {
  const cols = columns && columns.length > 0 ? columns : ["", "", "", ""];
  const rowCount = 8;
  return (
    <div className="relative" aria-busy="true" aria-label="Cargando">
      <table className="w-full border-collapse text-body">
        <thead className="sticky top-0 z-10">
          <tr>
            {cols.map((c, i) => (
              <th
                key={`${c}-${i}`}
                className={cn(
                  "border-b border-r px-3 py-2 text-left text-text-muted",
                  sectionBorder,
                  panel,
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="h-3 w-16 animate-pulse rounded bg-surface-elevated" />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rowCount }).map((_, r) => (
            <tr key={r} className="border-b border-border-subtle">
              {cols.map((_c, ci) => (
                <td key={ci} className="border-r border-border-subtle px-3 py-2">
                  <span
                    className="block h-3 animate-pulse rounded bg-surface-elevated"
                    style={{ width: `${40 + ((r * 13 + ci * 27) % 50)}%`, animationDelay: `${(r * 60 + ci * 30) % 700}ms` }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
