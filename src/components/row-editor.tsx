import { Code2, Copy, Rows3, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/code-editor";
import { pushToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export type RowValue = string | number | boolean | null;

export interface ColumnMeta {
  primary: boolean;
  unique: boolean;
  indexed: boolean;
}

/** Plugin-supplied column shape (postgres today, others schemaless). */
export interface ColumnInfo {
  name: string;
  type?: string;
  data_type?: string;
  udt?: string;
  nullable?: boolean;
  default?: string | null;
  max_length?: number | null;
  primary?: boolean;
}

interface Props {
  mode: "insert" | "edit";
  pkColumn?: string;
  pkValue?: string | number;
  table: string;
  columns: string[];
  colMeta: Map<string, ColumnMeta>;
  columnsInfo: ColumnInfo[];
  initialValues: Record<string, RowValue>;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (values: Record<string, RowValue>) => void;
}

const AUTO_TIMESTAMP_RE = /(^|_)at$|^(created|updated|inserted|deleted)_at$/i;

const NUMERIC_TYPES = new Set([
  "smallint", "integer", "bigint", "int2", "int4", "int8",
  "numeric", "decimal", "real", "double precision", "float4", "float8",
  "smallserial", "serial", "bigserial",
]);
const BOOLEAN_TYPES = new Set(["boolean", "bool"]);
const JSON_TYPES = new Set(["json", "jsonb"]);
const LONG_TEXT_TYPES = new Set(["text", "varchar", "bytea", "xml"]);

function isNumeric(t?: string) { return !!t && NUMERIC_TYPES.has(t.toLowerCase()); }
function isBoolean(t?: string) { return !!t && BOOLEAN_TYPES.has(t.toLowerCase()); }
function isJsonish(t?: string) { return !!t && JSON_TYPES.has(t.toLowerCase()); }
function isLongText(t?: string) { return !!t && LONG_TEXT_TYPES.has(t.toLowerCase()); }

export function RowEditor({
  mode,
  pkColumn,
  pkValue,
  table,
  columns,
  colMeta,
  columnsInfo,
  initialValues,
  saving,
  error,
  onCancel,
  onSave,
}: Props) {
  const isInsert = mode === "insert";
  const infoByName = useMemo(() => {
    const map = new Map<string, ColumnInfo>();
    for (const c of columnsInfo) map.set(c.name, c);
    return map;
  }, [columnsInfo]);

  const editable = useMemo(() => {
    if (!isInsert) return columns;
    return columns.filter((c) => !(pkColumn && c === pkColumn));
  }, [columns, isInsert, pkColumn]);

  const buildInitial = useMemo(() => {
    return (): { values: Record<string, RowValue>; nulls: Record<string, boolean> } => {
      const values: Record<string, RowValue> = {};
      const nulls: Record<string, boolean> = {};
      for (const c of editable) {
        const info = infoByName.get(c);
        const provided = initialValues[c];
        if (!isInsert) {
          values[c] = provided === undefined ? null : provided;
          nulls[c] = provided === null || provided === undefined;
          continue;
        }
        const nullable = info?.nullable !== false;
        const hasDefault = info?.default != null;
        const autoTs = AUTO_TIMESTAMP_RE.test(c);
        const preNull = nullable || hasDefault || autoTs;
        nulls[c] = preNull;
        values[c] = preNull ? null : defaultEmpty(info?.type);
      }
      return { values, nulls };
    };
  }, [editable, infoByName, initialValues, isInsert]);

  const initial = useMemo(buildInitial, [buildInitial]);
  const [values, setValues] = useState<Record<string, RowValue>>(initial.values);
  const [nulls, setNulls] = useState<Record<string, boolean>>(initial.nulls);
  const [view, setView] = useState<"form" | "json">("form");
  const [jsonDraft, setJsonDraft] = useState<string>(() => JSON.stringify(initial.values, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [validation, setValidation] = useState<Record<string, string>>({});
  const saveRef = useRef<() => void>(() => undefined);

  function setValue(col: string, value: RowValue) {
    setValues((p) => ({ ...p, [col]: value }));
    if (nulls[col]) setNulls((n) => ({ ...n, [col]: false }));
    setValidation((v) => ({ ...v, [col]: "" }));
  }
  function toggleNull(col: string) {
    const next = !nulls[col];
    setNulls((p) => ({ ...p, [col]: next }));
    setValues((p) => ({ ...p, [col]: next ? null : defaultEmpty(infoByName.get(col)?.type) }));
    setValidation((v) => ({ ...v, [col]: "" }));
  }
  function switchTo(next: "form" | "json") {
    if (next === view) return;
    if (next === "json") {
      setJsonDraft(JSON.stringify(values, null, 2));
      setJsonError(null);
      setView("json");
    } else {
      try {
        const parsed = JSON.parse(jsonDraft);
        if (parsed && typeof parsed === "object") {
          setValues(parsed);
          const nn: Record<string, boolean> = {};
          for (const k of Object.keys(parsed)) nn[k] = parsed[k] === null;
          setNulls(nn);
        }
        setJsonError(null);
        setView("form");
      } catch (e) {
        setJsonError(String(e));
      }
    }
  }

  function validateForm(): Record<string, string> {
    const errs: Record<string, string> = {};
    for (const c of editable) {
      const info = infoByName.get(c);
      const isNull = nulls[c];
      const nullable = info?.nullable !== false;
      const hasDefault = info?.default != null;
      if (isNull && !nullable && !hasDefault) {
        errs[c] = "No puede ser NULL";
        continue;
      }
      if (isNull) continue;
      const v = values[c];
      const type = info?.type;
      if (isNumeric(type) && typeof v === "string" && v.trim() === "") {
        errs[c] = "Número requerido";
        continue;
      }
      if (isNumeric(type) && typeof v === "string" && Number.isNaN(Number(v))) {
        errs[c] = "Número inválido";
        continue;
      }
      if (isJsonish(type) && typeof v === "string" && v.trim() !== "") {
        try { JSON.parse(v); } catch { errs[c] = "JSON inválido"; }
      }
    }
    return errs;
  }

  function buildPayload(): Record<string, RowValue> {
    const out: Record<string, RowValue> = {};
    for (const c of editable) {
      if (nulls[c]) { out[c] = null; continue; }
      const info = infoByName.get(c);
      const v = values[c];
      if (isNumeric(info?.type) && typeof v === "string") {
        const n = Number(v);
        out[c] = Number.isFinite(n) ? n : v;
      } else {
        out[c] = v;
      }
    }
    return out;
  }

  function handleSave() {
    if (view === "json") {
      let parsed: Record<string, RowValue>;
      try { parsed = JSON.parse(jsonDraft); }
      catch (e) { setJsonError(String(e)); return; }
      onSave(parsed);
      return;
    }
    const errs = validateForm();
    setValidation(errs);
    if (Object.keys(errs).length > 0) return;
    onSave(buildPayload());
  }
  saveRef.current = handleSave;

  function handleReset() {
    const fresh = buildInitial();
    setValues(fresh.values);
    setNulls(fresh.nulls);
    setValidation({});
    setJsonDraft(JSON.stringify(fresh.values, null, 2));
    setJsonError(null);
  }

  function copyAsSql() {
    const payload = view === "json" ? safeParse(jsonDraft) ?? buildPayload() : buildPayload();
    const sql = buildInsertSql(table, payload);
    navigator.clipboard.writeText(sql).catch(() => undefined);
    pushToast({ level: "success", title: "SQL copiado", body: sql.slice(0, 100) + (sql.length > 100 ? "…" : "") });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
      if (e.key === "Escape" && !saving) {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, saving]);

  const title = isInsert ? "Insertar fila" : `Editar fila — PK ${String(pkValue)}`;
  const hasMetadata = columnsInfo.length > 0;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex justify-center">
      <div
        className={cn(
          "pointer-events-auto flex w-full max-w-[1400px] flex-col rounded-t-xl border border-b-0 border-border-subtle bg-surface-overlay shadow-2xl",
          "animate-in slide-in-from-bottom duration-200",
        )}
        style={{ maxHeight: "min(60vh, 720px)" }}
      >
        {/* Header */}
        <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-h3 font-medium text-text">{title}</h2>
            <span className="text-caption truncate font-mono text-text-faint">{table}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="flex overflow-hidden rounded-md border border-border-subtle bg-surface text-caption">
              <button
                type="button"
                onClick={() => switchTo("form")}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-1 transition-colors",
                  view === "form" ? "bg-accent-soft text-accent" : "text-text-muted hover:bg-surface-hover",
                )}
              >
                <Rows3 className="h-3 w-3" /> Form
              </button>
              <button
                type="button"
                onClick={() => switchTo("json")}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-1 transition-colors",
                  view === "json" ? "bg-accent-soft text-accent" : "text-text-muted hover:bg-surface-hover",
                )}
              >
                <Code2 className="h-3 w-3" /> JSON
              </button>
            </div>
            <button type="button" onClick={copyAsSql} title="Copiar como INSERT SQL" className="rounded p-1 text-text-faint hover:bg-surface-hover hover:text-text">
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={handleReset} title="Restablecer" className="rounded p-1 text-text-faint hover:bg-surface-hover hover:text-text">
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button className="rounded p-1 text-text-faint hover:bg-surface-hover hover:text-text" onClick={onCancel} disabled={saving}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        {/* Body */}
        {view === "form" ? (
          <div className="flex-1 overflow-auto">
            <div className="grid grid-cols-1 gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {editable.map((col) => {
                const meta = colMeta.get(col);
                const info = infoByName.get(col);
                const isNull = nulls[col];
                const required = info?.nullable === false && info?.default == null;
                const value = values[col];
                const err = validation[col];
                const fullWidth = isJsonish(info?.type) || isLongText(info?.type) || (typeof value === "string" && (value.length > 80 || value.includes("\n")));
                return (
                  <div
                    key={col}
                    className={cn("flex flex-col gap-1", fullWidth && "sm:col-span-2 lg:col-span-3 xl:col-span-4")}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-caption inline-flex min-w-0 items-center gap-1.5 truncate">
                        <span className="truncate font-mono text-text">{col}</span>
                        {info?.type && (
                          <span className="text-tiny shrink-0 font-mono text-text-faint">{info.type}</span>
                        )}
                        {meta?.primary && (
                          <span className="text-tiny shrink-0 rounded-sm bg-accent-soft px-1 font-semibold uppercase tracking-wider text-accent">PK</span>
                        )}
                        {meta?.unique && !meta.primary && (
                          <span className="text-tiny shrink-0 rounded-sm bg-surface px-1 font-semibold uppercase tracking-wider text-text-muted">UQ</span>
                        )}
                        {required && (
                          <span className="text-tiny shrink-0 font-semibold text-danger" title="NOT NULL">*</span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleNull(col)}
                        className={cn(
                          "text-tiny shrink-0 rounded-sm px-1.5 py-0.5 font-semibold uppercase tracking-wider transition-colors",
                          isNull
                            ? "bg-accent-soft text-accent"
                            : "bg-surface text-text-faint hover:bg-surface-hover hover:text-text-muted",
                        )}
                        title={isNull ? "Quitar NULL" : "Marcar NULL"}
                      >
                        NULL
                      </button>
                    </div>
                    <FieldInput
                      type={info?.type}
                      value={value}
                      onChange={(v) => setValue(col, v)}
                      disabled={!!isNull}
                      invalid={!!err}
                      placeholder={isNull ? "NULL" : info?.default != null ? `default: ${info.default}` : ""}
                    />
                    {err && <p className="text-tiny text-danger">{err}</p>}
                  </div>
                );
              })}
              {editable.length === 0 && (
                <p className="text-body p-2 text-text-muted">Esta tabla no tiene columnas editables.</p>
              )}
            </div>
            {(isInsert && pkColumn) || (!hasMetadata && editable.length > 0) ? (
              <div className="border-t border-border-subtle bg-surface-elevated px-4 py-1.5 text-caption text-text-faint">
                {isInsert && pkColumn && (
                  <span>PK <span className="font-mono text-text-muted">{pkColumn}</span> la asigna la base de datos.</span>
                )}
                {!hasMetadata && editable.length > 0 && (
                  <span className="ml-2">Sin metadatos del plugin — validación parcial.</span>
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="min-h-[260px] flex-1 overflow-auto bg-surface">
            <CodeEditor
              lang="json"
              value={jsonDraft}
              onChange={(v) => { setJsonDraft(v); setJsonError(null); }}
              minHeight="260px"
            />
          </div>
        )}

        {(error || jsonError) && (
          <div className="border-t border-danger/40 bg-danger-soft px-4 py-2 text-body text-danger">
            {error ?? jsonError}
          </div>
        )}

        {/* Footer */}
        <footer className="flex items-center justify-between gap-2 border-t border-border-subtle px-4 py-2.5">
          <span className="text-caption text-text-faint">
            <kbd className="rounded border border-border-subtle bg-surface px-1.5 py-0.5 font-mono">⌘S</kbd> guardar ·
            <kbd className="ml-1 rounded border border-border-subtle bg-surface px-1.5 py-0.5 font-mono">Esc</kbd> cerrar
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>Cancelar</Button>
            <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function FieldInput({
  type,
  value,
  onChange,
  disabled,
  invalid,
  placeholder,
}: {
  type?: string;
  value: RowValue;
  onChange: (v: RowValue) => void;
  disabled: boolean;
  invalid: boolean;
  placeholder?: string;
}) {
  if (isBoolean(type) || typeof value === "boolean") {
    const v = typeof value === "boolean" ? value : value === "true";
    return (
      <label className="text-body inline-flex h-7 items-center gap-2 rounded border border-border-subtle bg-surface px-2">
        <input
          type="checkbox"
          checked={v}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="h-3.5 w-3.5 accent-accent"
        />
        <span className="text-text-muted">{disabled ? "—" : v ? "true" : "false"}</span>
      </label>
    );
  }
  if (isNumeric(type)) {
    return (
      <input
        type="number"
        value={value == null ? "" : String(value)}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputCls(invalid), "disabled:opacity-40")}
      />
    );
  }
  const str = value == null ? "" : String(value);
  if (isJsonish(type) || isLongText(type) || str.length > 80 || str.includes("\n")) {
    return (
      <textarea
        value={str}
        rows={Math.min(6, Math.max(2, str.split("\n").length))}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputCls(invalid), "resize-y disabled:opacity-40")}
      />
    );
  }
  return (
    <input
      type="text"
      value={str}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn(inputCls(invalid), "disabled:opacity-40")}
    />
  );
}

function inputCls(invalid: boolean) {
  return cn(
    "text-body-mono h-7 w-full rounded border bg-surface px-2 text-text outline-none transition-colors",
    invalid ? "border-danger focus:border-danger" : "border-border-subtle focus:border-accent",
  );
}

function defaultEmpty(type: string | undefined): RowValue {
  if (isBoolean(type)) return false;
  if (isNumeric(type)) return "";
  return "";
}

function safeParse(s: string): Record<string, RowValue> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

function buildInsertSql(table: string, values: Record<string, RowValue>): string {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return `INSERT INTO "${table}" DEFAULT VALUES;`;
  const cols = entries.map(([k]) => `"${k}"`).join(", ");
  const vals = entries
    .map(([, v]) => {
      if (v === null) return "NULL";
      if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
      if (typeof v === "number") return String(v);
      return `'${String(v).replace(/'/g, "''")}'`;
    })
    .join(", ");
  return `INSERT INTO "${table}" (${cols}) VALUES (${vals});`;
}
