import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  History,
  Loader2,
  Play,
  Sparkles,
  Square,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorView } from "@uiw/react-codemirror";
import { format as formatSql } from "sql-formatter";

import { CodeEditor } from "@/components/code-editor";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { mutedText, panel, sectionBorder } from "@/lib/styles";
import { getSchema, type SchemaMap } from "@/lib/schema-cache";
import { saveCsv, saveJson } from "@/lib/save-file";
import type { Connection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useSessionsStore, type QueryHistoryEntry, type SqlSession } from "@/store/sessions";

type ExecCell = string | number | boolean | null;

type ExecResult = {
  columns: string[];
  column_types?: string[];
  rows: ExecCell[][];
  total: number;
  affected: number | null;
  query_ms: number;
  was_capped: boolean;
  statement: string;
  extra_statements_discarded: boolean;
};

const MUTATION_RE =
  /^\s*(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|REINDEX|VACUUM|MERGE)\b/i;

function firstStmt(sql: string): string {
  // Frontend mirror of the plugin's split — gives the user a stable preview in
  // the mutation modal. Backend still does the canonical split.
  const stripped = sql.split(";", 1)[0] ?? sql;
  return stripped.trim();
}

function stripLeadingComments(sql: string): string {
  let s = sql.trimStart();
  while (true) {
    if (s.startsWith("--")) {
      const nl = s.indexOf("\n");
      s = nl < 0 ? "" : s.slice(nl + 1).trimStart();
    } else if (s.startsWith("/*")) {
      const end = s.indexOf("*/");
      s = end < 0 ? "" : s.slice(end + 2).trimStart();
    } else {
      break;
    }
  }
  return s;
}

function tryParseJson(s: string): unknown | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

function fmtTs(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function SqlQueriesPage({
  connection,
  database,
  onConsumeInsertRequest,
  insertRequest,
}: {
  connection: Connection;
  database: string;
  /** Token bumped by parent whenever a sidebar click should inject SQL. */
  insertRequest?: { token: number; sql: string };
  onConsumeInsertRequest?: () => void;
}) {
  const { sessions, updateSession } = useSessionsStore();
  const stored = sessions[connection.id] as SqlSession | undefined;

  const [draft, setDraft] = useState(stored?.queryDraft ?? "");
  const [running, setRunning] = useState(false);
  const [currentQueryId, setCurrentQueryId] = useState<string | null>(null);
  const [result, setResult] = useState<ExecResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingMutation, setPendingMutation] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [jsonPreview, setJsonPreview] = useState<unknown | null>(null);
  const [schemaMap, setSchemaMap] = useState<SchemaMap | undefined>(undefined);

  useEffect(() => {
    if (!connection || !database) return;
    let cancelled = false;
    getSchema(connection, database).then((m) => {
      if (!cancelled) setSchemaMap(m);
    });
    return () => {
      cancelled = true;
    };
  }, [connection, database]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const editorViewRef = useRef<EditorView | null>(null);
  const runRef = useRef<() => void>(() => undefined);
  const cancelRef = useRef<() => void>(() => undefined);

  // Persist draft to session (debounced via the store's auto-save).
  useEffect(() => {
    if (!stored) return;
    if (stored.queryDraft === draft) return;
    updateSession(connection.id, { queryDraft: draft });
  }, [draft, connection.id, stored, updateSession]);

  // Sidebar click-to-insert: insert at editor cursor if mounted, else append.
  useEffect(() => {
    if (!insertRequest) return;
    const sql = insertRequest.sql;
    const view = editorViewRef.current;
    if (view) {
      const sel = view.state.selection.main;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: sql },
        selection: { anchor: sel.from + sql.length },
      });
      setDraft(view.state.doc.toString());
    } else {
      setDraft((prev) => prev + sql);
    }
    onConsumeInsertRequest?.();
  }, [insertRequest, onConsumeInsertRequest]);

  const pushHistory = useCallback(
    (entry: QueryHistoryEntry) => {
      const current = (sessions[connection.id] as SqlSession | undefined)?.queryHistory ?? [];
      const next = [entry, ...current].slice(0, 20);
      updateSession(connection.id, { queryHistory: next });
    },
    [sessions, connection.id, updateSession],
  );

  const runConfirmed = useCallback(
    async (sql: string) => {
      const qid =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setCurrentQueryId(qid);
      setRunning(true);
      setError(null);
      setResult(null);
      const t0 = Date.now();
      try {
        const res = await invoke<ExecResult>("execute_sql_query", {
          input: connection,
          database,
          sql,
          queryId: qid,
          cap: null,
        });
        setResult(res);
        pushHistory({
          sql,
          ts: t0,
          ok: true,
          ms: res.query_ms,
          rows: res.total,
          affected: res.affected,
        });
      } catch (e) {
        setError(String(e));
        pushHistory({ sql, ts: t0, ok: false });
      } finally {
        setRunning(false);
        setCurrentQueryId(null);
      }
    },
    [connection, database, pushHistory],
  );

  const run = useCallback(() => {
    const sql = firstStmt(draft);
    if (!sql) return;
    // Strip leading line/block comments + whitespace before testing for
    // mutation so the placeholder comment doesn't fool the regex.
    const codeStart = stripLeadingComments(sql);
    if (!codeStart) return;
    if (MUTATION_RE.test(codeStart)) {
      setPendingMutation(sql);
      return;
    }
    void runConfirmed(sql);
  }, [draft, runConfirmed]);

  const cancel = useCallback(() => {
    if (!currentQueryId) return;
    invoke("cancel_sql_query", { input: connection, queryId: currentQueryId }).catch(
      () => undefined,
    );
  }, [currentQueryId, connection]);

  runRef.current = run;
  cancelRef.current = cancel;

  const editorExtensions = useMemo(
    () => [
      EditorView.lineWrapping,
      EditorView.domEventHandlers({
        keydown: (event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            runRef.current();
            return true;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancelRef.current();
            return true;
          }
          return false;
        },
      }),
      EditorView.updateListener.of((u) => {
        if (u.view) editorViewRef.current = u.view;
      }),
    ],
    [],
  );

  // Global Escape → cancel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && running) {
        e.preventDefault();
        cancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, cancel]);

  function doFormat() {
    try {
      const formatted = formatSql(draft, { language: "postgresql", keywordCase: "upper" });
      setDraft(formatted);
    } catch (e) {
      pulseToast(`Error al formatear: ${String(e)}`);
    }
  }

  function pulseToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2000);
  }

  function copyCell(value: ExecCell) {
    const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
    navigator.clipboard.writeText(text).catch(() => undefined);
    pulseToast("Copiado");
  }

  function cellToString(v: ExecCell): string {
    if (v == null) return "";
    if (typeof v === "string") return v;
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  }

  async function exportCsv() {
    if (!result) return;
    const lines = [csvRow(result.columns)];
    for (const row of result.rows) lines.push(csvRow(row.map(cellToString)));
    await saveCsv(lines.join("\n"), {
      defaultPath: `query-${Date.now()}.csv`,
      title: "Exportar resultado",
    });
    setExportOpen(false);
  }

  async function exportJson() {
    if (!result) return;
    const arr = result.rows.map((row) => {
      const obj: Record<string, ExecCell> = {};
      result.columns.forEach((c, i) => {
        obj[c] = row[i] ?? null;
      });
      return obj;
    });
    await saveJson(arr, {
      defaultPath: `query-${Date.now()}.json`,
      title: "Exportar resultado",
    });
    setExportOpen(false);
  }

  const history = (stored?.queryHistory ?? []) as QueryHistoryEntry[];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Editor (40%) */}
      <div className={cn("flex-[2] min-h-0 overflow-hidden border-b", sectionBorder)}>
        <CodeEditor
          lang="postgresql"
          value={draft}
          onChange={(v) => setDraft(v)}
          extraExtensions={editorExtensions}
          schema={schemaMap}
          placeholder="-- SELECT * FROM ...   (⌘/Ctrl+Enter para ejecutar)"
          minHeight="100%"
          maxHeight="100%"
          className="h-full"
        />
      </div>

      {/* Toolbar */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 border-b bg-surface/40 px-3 py-2",
          sectionBorder,
        )}
      >
        {running ? (
          <Button size="sm" variant="danger" onClick={cancel} title="Esc">
            <Square className="h-3.5 w-3.5" /> Cancelar
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={run} title="⌘/Ctrl+Enter">
            <Play className="h-3.5 w-3.5" /> Ejecutar
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={doFormat} disabled={running}>
          <Sparkles className="h-3.5 w-3.5" /> Formatear
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            if (!draft.trim()) return;
            navigator.clipboard.writeText(draft).catch(() => undefined);
            pulseToast("SQL copiado");
          }}
          disabled={running || !draft.trim()}
          title="Copiar SQL del editor"
        >
          <Copy className="h-3.5 w-3.5" /> Copiar
        </Button>

        <div className="relative">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setHistoryOpen((o) => !o)}
            disabled={history.length === 0}
          >
            <History className="h-3.5 w-3.5" /> Historial ({history.length})
          </Button>
          {historyOpen && (
            <HistoryPanel
              entries={history}
              onPick={(sql) => {
                setDraft(sql);
                setHistoryOpen(false);
              }}
              onClose={() => setHistoryOpen(false)}
            />
          )}
        </div>

        <div className="relative">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setExportOpen((o) => !o)}
            disabled={!result || result.rows.length === 0}
          >
            <Download className="h-3.5 w-3.5" /> Exportar
          </Button>
          {exportOpen && (
            <div
              className="absolute right-0 top-full z-30 mt-1 w-40 overflow-hidden rounded-md border border-border-subtle bg-surface-overlay p-1 shadow-xl"
              onMouseLeave={() => setExportOpen(false)}
            >
              <button
                onClick={exportCsv}
                className="text-body block w-full rounded px-2 py-1.5 text-left text-text transition-colors hover:bg-surface-hover"
              >
                CSV
              </button>
              <button
                onClick={exportJson}
                className="text-body block w-full rounded px-2 py-1.5 text-left text-text transition-colors hover:bg-surface-hover"
              >
                JSON
              </button>
            </div>
          )}
        </div>

        <div className={cn("text-caption ml-auto", mutedText)}>
          {running && (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> ejecutando…
            </span>
          )}
          {!running && result && (
            <span>
              {result.affected != null && result.columns.length === 0
                ? `${result.affected} afectadas · `
                : `${result.total} filas · `}
              {result.query_ms} ms
              {result.was_capped && " · limitado"}
            </span>
          )}
        </div>
      </div>

      {/* Results (60%) */}
      <div className="flex-[3] min-h-0 overflow-hidden">
        <ResultsView
          result={result}
          error={error}
          onCellClick={copyCell}
          onOpenJson={(v) => setJsonPreview(v)}
        />
      </div>

      {/* Mutation confirm modal */}
      {pendingMutation && (
        <Modal onClose={() => setPendingMutation(null)}>
          <div className="w-full max-w-lg rounded-lg border border-border-subtle bg-surface-overlay p-5 shadow-xl">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-danger" />
              <h2 className="text-h3 font-semibold text-text">Confirma la mutación</h2>
            </div>
            <p className={cn("mt-2 text-body", mutedText)}>
              Esta consulta modifica datos. ¿Ejecutar de todos modos?
            </p>
            <pre className="text-body-mono mt-3 max-h-48 overflow-auto rounded-md border border-border-subtle bg-surface-sunken p-3 text-text">
              {truncate(pendingMutation, 800)}
            </pre>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPendingMutation(null)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  const sql = pendingMutation;
                  setPendingMutation(null);
                  void runConfirmed(sql);
                }}
              >
                Ejecutar
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* JSON expand modal */}
      {jsonPreview !== null && (
        <Modal onClose={() => setJsonPreview(null)}>
          <div className="w-full max-w-2xl rounded-lg border border-border-subtle bg-surface-overlay p-5 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-h3 font-semibold text-text">Valor JSON</h2>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(jsonPreview, null, 2)).catch(() => undefined);
                  pulseToast("Copiado");
                }}
                className="rounded p-1.5 text-text-faint transition-colors hover:bg-surface-hover hover:text-text"
                title="Copiar"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            <pre className="text-body-mono max-h-[60vh] overflow-auto rounded-md border border-border-subtle bg-surface-sunken p-3 text-text">
              {JSON.stringify(jsonPreview, null, 2)}
            </pre>
          </div>
        </Modal>
      )}

      {/* Toast */}
      {toast && (
        <div className="text-body pointer-events-none fixed bottom-4 right-4 z-50 rounded-md border border-border-subtle bg-surface-overlay px-3 py-2 text-text shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}

function csvRow(cells: string[]): string {
  return cells
    .map((c) => {
      const needsQuote = /[",\n]/.test(c);
      const escaped = c.replace(/"/g, '""');
      return needsQuote ? `"${escaped}"` : escaped;
    })
    .join(",");
}

function ResultsView({
  result,
  error,
  onCellClick,
  onOpenJson,
}: {
  result: ExecResult | null;
  error: string | null;
  onCellClick: (v: ExecCell) => void;
  onOpenJson: (v: unknown) => void;
}) {
  if (error) {
    return (
      <div className="h-full overflow-auto p-4">
        <div className="mx-auto flex w-full max-w-3xl items-start gap-3 rounded-md border border-danger/40 bg-danger-soft p-4">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="text-body font-medium text-danger">Error al ejecutar la consulta</p>
            <pre className="text-body-mono mt-1 break-all whitespace-pre-wrap text-danger/80">{error}</pre>
          </div>
        </div>
      </div>
    );
  }
  if (!result) {
    return (
      <div className={cn("flex h-full items-center justify-center text-body", mutedText)}>
        Sin resultados. Escribe una consulta y pulsa Ejecutar (⌘/Ctrl+Enter).
      </div>
    );
  }
  if (result.columns.length === 0 && result.affected != null) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-success/40 bg-success-soft px-8 py-6 text-center">
          <CheckCircle2 className="h-8 w-8 text-success" />
          <p className="text-metric font-semibold text-success">
            {result.affected} {result.affected === 1 ? "fila afectada" : "filas afectadas"}
          </p>
          <p className="text-body text-success/80">
            {result.query_ms} ms · {result.statement.slice(0, 80)}
            {result.statement.length > 80 && "…"}
          </p>
        </div>
      </div>
    );
  }
  return <ResultsTable result={result} onCellClick={onCellClick} onOpenJson={onOpenJson} />;
}

const NUMERIC_TYPES = new Set([
  "int2", "int4", "int8", "smallint", "integer", "bigint",
  "float4", "float8", "real", "double precision", "numeric", "decimal",
]);
const JSON_TYPES = new Set(["json", "jsonb"]);

type ColKind = "numeric" | "json" | "bool" | "text";

function colKindFromType(t: string | undefined): ColKind {
  if (!t) return "text";
  const n = t.toLowerCase();
  if (n === "bool" || n === "boolean") return "bool";
  if (JSON_TYPES.has(n)) return "json";
  if (NUMERIC_TYPES.has(n)) return "numeric";
  return "text";
}

function ResultsTable({
  result,
  onCellClick,
  onOpenJson,
}: {
  result: ExecResult;
  onCellClick: (v: ExecCell) => void;
  onOpenJson: (v: unknown) => void;
}) {
  const colKinds = useMemo<ColKind[]>(
    () => result.columns.map((_, i) => colKindFromType(result.column_types?.[i])),
    [result],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {(result.was_capped || result.extra_statements_discarded) && (
        <div className="text-caption shrink-0 border-b border-info/30 bg-info-soft px-3 py-1.5 text-info">
          {result.was_capped && (
            <span>Resultado limitado a {result.total} filas (consulta sin LIMIT).</span>
          )}
          {result.extra_statements_discarded && (
            <span className="ml-2">Solo se ejecutó la primera sentencia; el resto fue ignorado.</span>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-body">
          <thead className="sticky top-0 z-10">
            <tr>
              <th
                className={cn(
                  "w-12 border-b border-r px-2 py-2 text-right font-medium whitespace-nowrap text-text-faint",
                  sectionBorder,
                  panel,
                )}
              >
                #
              </th>
              {result.columns.map((c, i) => (
                <th
                  key={i}
                  className={cn(
                    "border-b border-r px-3 py-2 text-left font-medium whitespace-nowrap text-text-muted select-none",
                    sectionBorder,
                    panel,
                  )}
                >
                  <div className="flex items-baseline gap-1.5">
                    <span className="truncate">{c}</span>
                    {result.column_types?.[i] && (
                      <span className="text-tiny font-mono text-text-faint">
                        {result.column_types[i]}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, ri) => (
              <tr
                key={ri}
                className="group border-b border-border-subtle transition-colors hover:bg-surface-elevated/50"
              >
                <td className="border-r border-border-subtle px-2 py-1.5 text-right font-mono text-text-faint">
                  {ri + 1}
                </td>
                {row.map((v, i) => (
                  <Cell
                    key={i}
                    value={v}
                    kind={colKinds[i]}
                    onClick={() => onCellClick(v)}
                    onOpenJson={onOpenJson}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({
  value,
  kind,
  onClick,
  onOpenJson,
}: {
  value: ExecCell;
  kind: ColKind;
  onClick: () => void;
  onOpenJson: (v: unknown) => void;
}) {
  if (value == null) {
    return (
      <td
        onClick={onClick}
        className="cursor-pointer border-r border-border-subtle px-3 py-1.5 text-text"
      >
        <span className="text-caption rounded bg-surface-sunken px-1.5 py-0.5 text-text-faint">null</span>
      </td>
    );
  }
  if (kind === "json") {
    const display = typeof value === "string" ? value : JSON.stringify(value);
    const parsed = typeof value === "string" ? tryParseJson(value) : value;
    return (
      <td
        onClick={onClick}
        className="cursor-pointer border-r border-border-subtle px-3 py-1.5 text-text"
        title={display}
      >
        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (parsed !== undefined) onOpenJson(parsed);
            }}
            className="text-tiny shrink-0 rounded border border-info/40 bg-info-soft px-1.5 py-0.5 font-bold uppercase tracking-wider text-info hover:brightness-110"
          >
            json
          </button>
          <span className="block max-w-70 truncate font-mono">{truncate(display, 200)}</span>
        </div>
      </td>
    );
  }
  const isNumeric = kind === "numeric" || typeof value === "number";
  const display = typeof value === "string" ? value : String(value);
  return (
    <td
      onClick={onClick}
      className={cn(
        "cursor-pointer border-r border-border-subtle px-3 py-1.5",
        isNumeric ? "text-right font-mono text-accent" : "text-text",
      )}
    >
      <span className="block max-w-70 truncate font-mono" title={display}>
        {truncate(display, 200)}
      </span>
    </td>
  );
}

function HistoryPanel({
  entries,
  onPick,
  onClose,
}: {
  entries: QueryHistoryEntry[];
  onPick: (sql: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute right-0 top-full z-30 mt-1 max-h-96 w-[420px] overflow-auto rounded-md border border-border-subtle bg-surface-overlay shadow-xl"
      onMouseLeave={onClose}
    >
      {entries.length === 0 ? (
        <p className="text-body p-3 text-text-faint">Sin historial.</p>
      ) : (
        entries.map((e, i) => (
          <button
            key={i}
            onClick={() => onPick(e.sql)}
            className="block w-full border-b border-border-subtle px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-surface-hover"
          >
            <div className="text-caption flex items-center gap-2 text-text-faint">
              {e.ok ? (
                <Check className="h-3 w-3 text-success" />
              ) : (
                <XCircle className="h-3 w-3 text-danger" />
              )}
              <span>{fmtTs(e.ts)}</span>
              {e.ms != null && <span>· {e.ms} ms</span>}
              {e.rows != null && <span>· {e.rows} filas</span>}
              {e.affected != null && <span>· {e.affected} afectadas</span>}
            </div>
            <pre className="text-body-mono mt-1 truncate text-text">{truncate(e.sql, 200)}</pre>
          </button>
        ))
      )}
    </div>
  );
}
