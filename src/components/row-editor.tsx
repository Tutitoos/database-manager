import { Code2, Copy, Rows3, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/modal";
import { CodeEditor } from "@/components/code-editor";
import { pushToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export type RowValue = string | number | boolean | null;

export interface ColumnMeta {
  primary: boolean;
  unique: boolean;
  indexed: boolean;
}

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

type Kind = "number" | "boolean" | "text" | "json" | "date" | "uuid" | "bytea" | "unknown";

const KIND_BY_TYPE: Record<string, Kind> = {
  smallint: "number", integer: "number", bigint: "number",
  int2: "number", int4: "number", int8: "number",
  numeric: "number", decimal: "number", real: "number",
  "double precision": "number", float4: "number", float8: "number",
  smallserial: "number", serial: "number", bigserial: "number",
  boolean: "boolean", bool: "boolean",
  text: "text", varchar: "text", char: "text", character: "text", citext: "text", name: "text",
  json: "json", jsonb: "json",
  date: "date", time: "date", timestamp: "date", timestamptz: "date",
  "timestamp without time zone": "date", "timestamp with time zone": "date",
  uuid: "uuid",
  bytea: "bytea",
};

function kindOf(type?: string): Kind {
  if (!type) return "unknown";
  return KIND_BY_TYPE[type.toLowerCase()] ?? "unknown";
}

/** Short label for the type chip — postgres reports verbose names like
 *  "timestamp with time zone" / "character varying" that blow up the header. */
const TYPE_SHORT: Record<string, string> = {
  "timestamp with time zone": "timestamptz",
  "timestamp without time zone": "timestamp",
  "time with time zone": "timetz",
  "time without time zone": "time",
  "character varying": "varchar",
  "character": "char",
  "double precision": "float8",
};
function shortType(type?: string): string {
  if (!type) return "";
  const lower = type.toLowerCase();
  return TYPE_SHORT[lower] ?? lower;
}

const KIND_STYLE: Record<Kind, { border: string; chip: string }> = {
  number:  { border: "border-l-sky-500/70",     chip: "bg-sky-500/15 text-sky-300" },
  boolean: { border: "border-l-violet-500/70",  chip: "bg-violet-500/15 text-violet-300" },
  text:    { border: "border-l-emerald-500/70", chip: "bg-emerald-500/15 text-emerald-300" },
  json:    { border: "border-l-rose-500/70",    chip: "bg-rose-500/15 text-rose-300" },
  date:    { border: "border-l-amber-500/70",   chip: "bg-amber-500/15 text-amber-300" },
  uuid:    { border: "border-l-cyan-500/70",    chip: "bg-cyan-500/15 text-cyan-300" },
  bytea:   { border: "border-l-slate-500/70",   chip: "bg-slate-500/20 text-slate-300" },
  unknown: { border: "border-l-border-subtle",  chip: "bg-surface text-text-muted" },
};

/* ───────────────────── NULL semantics ─────────────────────
 * Empty string and explicit null are both treated as "no value provided" — on
 * save we coerce them to SQL NULL if the column is nullable. The "• null" pill
 * is a visual indicator of that state; clicking it just clears the input. For
 * boolean we use an explicit tri-state (TRUE / FALSE / null).
 */
function isNullish(v: RowValue): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string" && v === "") return true;
  return false;
}

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

  const editable = useMemo(
    () => (isInsert ? columns.filter((c) => !(pkColumn && c === pkColumn)) : columns),
    [columns, isInsert, pkColumn],
  );

  const buildInitial = useMemo(() => {
    return (): Record<string, RowValue> => {
      const values: Record<string, RowValue> = {};
      for (const c of editable) {
        const info = infoByName.get(c);
        const k = kindOf(info?.type);
        if (!isInsert) {
          const provided = initialValues[c];
          values[c] = provided === undefined ? null : provided;
          continue;
        }
        // INSERT defaults to an empty value across the board (string ""), which
        // gets coerced to NULL on save when the column is nullable / has a
        // default. Booleans need an explicit null since false is a real value.
        values[c] = k === "boolean" ? null : "";
      }
      return values;
    };
  }, [editable, infoByName, initialValues, isInsert]);

  const initial = useMemo(buildInitial, [buildInitial]);
  const [values, setValues] = useState<Record<string, RowValue>>(initial);
  const [view, setView] = useState<"form" | "json">("form");
  const [jsonDraft, setJsonDraft] = useState<string>(() => JSON.stringify(initial, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [validation, setValidation] = useState<Record<string, string>>({});
  const saveRef = useRef<() => void>(() => undefined);

  function setValue(col: string, value: RowValue) {
    setValues((p) => ({ ...p, [col]: value }));
    setValidation((v) => ({ ...v, [col]: "" }));
  }

  function clearToNull(col: string) {
    const info = infoByName.get(col);
    const k = kindOf(info?.type);
    setValue(col, k === "boolean" ? null : "");
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
        if (parsed && typeof parsed === "object") setValues(parsed);
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
      const k = kindOf(info?.type);
      const v = values[c];
      const empty = isNullish(v);
      const nullable = info?.nullable !== false;
      const hasDefault = info?.default != null;
      if (empty) {
        if (!nullable && !hasDefault) errs[c] = "Requerido";
        continue;
      }
      if (k === "number" && typeof v === "string" && Number.isNaN(Number(v))) {
        errs[c] = "Número inválido";
      }
      if (k === "json" && typeof v === "string") {
        try { JSON.parse(v); } catch { errs[c] = "JSON inválido"; }
      }
    }
    return errs;
  }

  function buildPayload(): Record<string, RowValue> {
    const out: Record<string, RowValue> = {};
    for (const c of editable) {
      const v = values[c];
      const info = infoByName.get(c);
      const k = kindOf(info?.type);
      const hasDefault = info?.default != null;
      // Empty fields → NULL on the wire, but skip them entirely when there's a
      // server-side default so the DB can fill them in (omitting from the
      // payload keeps INSERT (...) DEFAULT semantics working).
      if (isNullish(v)) {
        if (hasDefault && isInsert) continue;
        out[c] = null;
        continue;
      }
      if (k === "number" && typeof v === "string") {
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
    setValues(fresh);
    setValidation({});
    setJsonDraft(JSON.stringify(fresh, null, 2));
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
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const title = isInsert ? "Insertar fila" : "Editar fila";
  const hasMetadata = columnsInfo.length > 0;

  return (
    <Modal onClose={() => !saving && onCancel()} closeOnBackdrop={false}>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface-overlay shadow-2xl">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-6 py-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-h2 font-semibold text-text">{title}</h2>
            <div className="text-caption flex items-center gap-1.5 text-text-muted">
              <span className="font-mono text-text">{table}</span>
              {!isInsert && pkValue !== undefined && (
                <>
                  <span className="text-text-faint">·</span>
                  <span>PK</span>
                  <span className="font-mono text-text">{String(pkValue)}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <div className="flex overflow-hidden rounded-md border border-border-subtle bg-surface text-caption">
              <button
                type="button"
                onClick={() => switchTo("form")}
                className={cn(
                  "inline-flex items-center gap-1 px-2.5 py-1.5 transition-colors",
                  view === "form" ? "bg-accent-soft text-accent" : "text-text-muted hover:bg-surface-hover",
                )}
              >
                <Rows3 className="h-3 w-3" /> Form
              </button>
              <button
                type="button"
                onClick={() => switchTo("json")}
                className={cn(
                  "inline-flex items-center gap-1 px-2.5 py-1.5 transition-colors",
                  view === "json" ? "bg-accent-soft text-accent" : "text-text-muted hover:bg-surface-hover",
                )}
              >
                <Code2 className="h-3 w-3" /> JSON
              </button>
            </div>
            <IconBtn title="Copiar como INSERT SQL" onClick={copyAsSql}><Copy className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Restablecer" onClick={handleReset}><RotateCcw className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Cerrar" onClick={onCancel} disabled={saving}><X className="h-3.5 w-3.5" /></IconBtn>
          </div>
        </header>

        {/* Body */}
        {view === "form" ? (
          <div className="flex-1 overflow-auto px-6 py-5">
            <div className="flex flex-col gap-3">
              {editable.map((col) => {
                const meta = colMeta.get(col);
                const info = infoByName.get(col);
                const k = kindOf(info?.type);
                const style = KIND_STYLE[k];
                const required = info?.nullable === false && info?.default == null;
                const value = values[col];
                const err = validation[col];
                const nullish = isNullish(value);
                return (
                  <div
                    key={col}
                    className={cn(
                      "rounded-lg border border-border-subtle bg-surface-elevated transition-colors",
                      "border-l-4",
                      style.border,
                      err && "border-danger/60 border-l-danger",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-3">
                      <span className="font-mono text-body font-medium text-text">{col}</span>
                      {info?.type && (
                        <span
                          className={cn("rounded-sm px-1 py-px font-mono text-[10px] leading-none lowercase", style.chip)}
                          title={info.type}
                        >
                          {shortType(info.type)}
                        </span>
                      )}
                      {meta?.primary && (
                        <span className="rounded-sm bg-accent-soft px-1 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-accent">
                          pk
                        </span>
                      )}
                      {meta?.unique && !meta.primary && (
                        <span className="rounded-sm bg-surface px-1 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-text-muted">
                          uq
                        </span>
                      )}
                      {required && (
                        <span className="rounded-sm bg-danger-soft px-1 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-danger">
                          required
                        </span>
                      )}
                      {info?.default != null && (
                        <span className="truncate font-mono text-[10px] text-text-faint" title={`default: ${info.default}`}>
                          default {info.default.length > 20 ? info.default.slice(0, 20) + "…" : info.default}
                        </span>
                      )}
                      {nullish && (
                        <span
                          className="text-tiny ml-auto inline-flex cursor-pointer items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 font-semibold uppercase tracking-wide text-text-faint hover:text-text-muted"
                          onClick={() => clearToNull(col)}
                          title="Click para limpiar"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-text-faint" />
                          null
                        </span>
                      )}
                    </div>
                    <div className="px-4 pb-3">
                      <FieldInput
                        kind={k}
                        value={value}
                        onChange={(v) => setValue(col, v)}
                        onSetNull={() => clearToNull(col)}
                        invalid={!!err}
                        placeholder={info?.default != null ? `default: ${info.default}` : ""}
                      />
                      {err && <p className="text-caption mt-1.5 text-danger">{err}</p>}
                    </div>
                  </div>
                );
              })}
              {editable.length === 0 && (
                <p className="text-body p-4 text-text-muted">Esta tabla no tiene columnas editables.</p>
              )}
            </div>
            {(isInsert && pkColumn) || (!hasMetadata && editable.length > 0) ? (
              <div className="mt-4 rounded-md border border-border-subtle bg-surface px-3 py-2 text-caption text-text-muted">
                {isInsert && pkColumn && (
                  <p>
                    La columna <span className="font-mono text-text">{pkColumn}</span> la asigna la base de datos.
                  </p>
                )}
                {!hasMetadata && editable.length > 0 && (
                  <p>Sin metadatos del plugin — validación parcial.</p>
                )}
                {hasMetadata && (
                  <p>Vacío = NULL. Los campos requeridos no admiten vacío.</p>
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="min-h-[360px] flex-1 overflow-auto bg-surface">
            <CodeEditor
              lang="json"
              value={jsonDraft}
              onChange={(v) => { setJsonDraft(v); setJsonError(null); }}
              minHeight="360px"
            />
          </div>
        )}

        {(error || jsonError) && (
          <div className="border-t border-danger/40 bg-danger-soft px-6 py-2.5 text-body text-danger">
            {error ?? jsonError}
          </div>
        )}

        {/* Footer */}
        <footer className="flex items-center justify-between gap-2 border-t border-border-subtle px-6 py-4">
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
    </Modal>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="rounded-md p-1.5 text-text-faint transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function FieldInput({
  kind,
  value,
  onChange,
  onSetNull,
  invalid,
  placeholder,
}: {
  kind: Kind;
  value: RowValue;
  onChange: (v: RowValue) => void;
  onSetNull: () => void;
  invalid: boolean;
  placeholder?: string;
}) {
  // Booleans need an explicit tri-state (TRUE / FALSE / NULL) because false is
  // a real value distinct from "no value chosen".
  if (kind === "boolean") {
    const v = value === true ? "true" : value === false ? "false" : "null";
    return (
      <div className="flex items-center gap-1.5">
        <TriBtn active={v === "true"}  color="violet" onClick={() => onChange(true)}>TRUE</TriBtn>
        <TriBtn active={v === "false"} color="violet" onClick={() => onChange(false)}>FALSE</TriBtn>
        <TriBtn active={v === "null"}  color="neutral" onClick={onSetNull}>null</TriBtn>
      </div>
    );
  }
  if (kind === "number") {
    return (
      <input
        type="number"
        value={value == null ? "" : String(value)}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls(invalid)}
      />
    );
  }
  const str = value == null ? "" : String(value);
  const multi = kind === "json" || kind === "text" || kind === "bytea" || str.length > 80 || str.includes("\n");
  if (multi) {
    return (
      <textarea
        value={str}
        rows={Math.min(8, Math.max(3, str.split("\n").length + 1))}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputCls(invalid), "resize-y")}
      />
    );
  }
  return (
    <input
      type="text"
      value={str}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls(invalid)}
    />
  );
}

function TriBtn({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color: "violet" | "neutral";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const activeCls =
    color === "violet"
      ? "border-violet-500/40 bg-violet-500/15 text-violet-200"
      : "border-border-subtle bg-surface-hover text-text-muted";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-6 items-center rounded border px-2 text-[10px] font-semibold uppercase tracking-wide transition-colors",
        active ? activeCls : "border-border-subtle bg-surface text-text-faint hover:bg-surface-hover hover:text-text-muted",
      )}
    >
      {children}
    </button>
  );
}

function inputCls(invalid: boolean) {
  return cn(
    "w-full rounded border bg-surface px-2 py-1.5 font-mono text-[12px] leading-snug text-text outline-none transition-colors",
    "placeholder:text-[11px] placeholder:font-mono placeholder:normal-case placeholder:text-text-faint/70",
    invalid ? "border-danger focus:border-danger" : "border-border-subtle focus:border-accent",
  );
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
