import { Code2, Plus, Rows3, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/modal";
import { CodeEditor } from "@/components/code-editor";
import { cn } from "@/lib/utils";

export type RowValue = string | number | boolean | null;

export interface ColumnMeta {
  primary: boolean;
  unique: boolean;
  indexed: boolean;
}

interface Props {
  mode: "insert" | "edit";
  pkColumn?: string;
  pkValue?: string | number;
  columns: string[];
  colMeta: Map<string, ColumnMeta>;
  /** Initial values keyed by column name (used in edit mode). */
  initialValues: Record<string, RowValue>;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (values: Record<string, RowValue>) => void;
}

/**
 * Conventions baked in for inserts:
 * - The primary key is omitted entirely so the DB assigns it.
 * - Bookkeeping columns (`created_at`, `updated_at`, anything ending in `_at`)
 *   are pre-toggled to NULL so the DB default fires.
 */
const AUTO_TIMESTAMP_RE = /(^|_)at$|^(created|updated|inserted|deleted)_at$/i;

export function RowEditor({
  mode,
  pkColumn,
  pkValue,
  columns,
  colMeta,
  initialValues,
  saving,
  error,
  onCancel,
  onSave,
}: Props) {
  const isInsert = mode === "insert";
  const editable = useMemo(() => {
    if (!isInsert) return columns;
    return columns.filter((c) => !(pkColumn && c === pkColumn));
  }, [columns, isInsert, pkColumn]);

  const [view, setView] = useState<"form" | "json">("form");
  const [values, setValues] = useState<Record<string, RowValue>>(() => {
    const out: Record<string, RowValue> = {};
    for (const c of editable) {
      if (isInsert && AUTO_TIMESTAMP_RE.test(c)) {
        out[c] = null;
      } else {
        const v = initialValues[c];
        out[c] = v === undefined ? null : v;
      }
    }
    return out;
  });
  const [jsonDraft, setJsonDraft] = useState<string>(() => JSON.stringify(initialValues, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  function setValue(col: string, value: RowValue) {
    setValues((prev) => ({ ...prev, [col]: value }));
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

  function handleSave() {
    if (view === "json") {
      let parsed: Record<string, RowValue>;
      try {
        parsed = JSON.parse(jsonDraft);
      } catch (e) {
        setJsonError(String(e));
        return;
      }
      onSave(parsed);
      return;
    }
    onSave(values);
  }

  const title = isInsert ? "Insertar fila" : `Editar fila — PK ${String(pkValue)}`;

  return (
    <Modal onClose={() => !saving && onCancel()}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-border-subtle bg-surface-overlay shadow-xl">
        <header className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2 className="text-h3 font-medium text-text">{title}</h2>
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
            <button
              className="rounded p-1 text-text-faint hover:bg-surface-hover hover:text-text"
              onClick={onCancel}
              disabled={saving}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        {view === "form" ? (
          <div className="flex-1 overflow-auto">
            <table className="w-full text-body">
              <tbody>
                {editable.map((col) => {
                  const meta = colMeta.get(col);
                  const value = values[col];
                  const isNull = value === null;
                  return (
                    <tr key={col} className="border-b border-border-subtle last:border-b-0">
                      <td className="w-1/3 max-w-[240px] px-4 py-2 align-top">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-mono text-text">{col}</span>
                          {meta?.primary && (
                            <span className="text-tiny rounded-sm bg-accent-soft px-1 py-0.5 font-semibold uppercase tracking-wider text-accent">
                              PK
                            </span>
                          )}
                          {meta?.unique && !meta.primary && (
                            <span className="text-tiny rounded-sm bg-surface px-1 py-0.5 font-semibold uppercase tracking-wider text-text-muted">
                              UQ
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <FieldInput
                          value={value}
                          onChange={(v) => setValue(col, v)}
                          disabled={isNull}
                        />
                      </td>
                      <td className="w-20 px-3 py-2 text-right">
                        <label className="text-caption inline-flex cursor-pointer items-center gap-1.5 text-text-muted">
                          <input
                            type="checkbox"
                            checked={isNull}
                            onChange={(e) => setValue(col, e.target.checked ? null : "")}
                            className="h-3 w-3 accent-accent"
                          />
                          NULL
                        </label>
                      </td>
                    </tr>
                  );
                })}
                {editable.length === 0 && (
                  <tr>
                    <td className="text-body p-6 text-text-muted">
                      Esta tabla no tiene columnas editables.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {isInsert && pkColumn && (
              <p className="text-caption border-t border-border-subtle bg-surface-elevated px-4 py-2 text-text-muted">
                <Plus className="mr-1 inline h-3 w-3 align-text-bottom" />
                La columna <span className="font-mono text-text">{pkColumn}</span> la asigna la base de datos.
              </p>
            )}
          </div>
        ) : (
          <div className="min-h-[50vh] flex-1 overflow-auto bg-surface">
            <CodeEditor
              lang="json"
              value={jsonDraft}
              onChange={(v) => {
                setJsonDraft(v);
                setJsonError(null);
              }}
              minHeight="50vh"
            />
          </div>
        )}

        {(error || jsonError) && (
          <div className="border-t border-danger/40 bg-danger-soft px-4 py-2 text-body text-danger">
            {error ?? jsonError}
          </div>
        )}

        <footer className="flex justify-end gap-2 border-t border-border-subtle px-4 py-3">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}

function FieldInput({
  value,
  onChange,
  disabled,
}: {
  value: RowValue;
  onChange: (v: RowValue) => void;
  disabled: boolean;
}) {
  if (typeof value === "boolean") {
    return (
      <label className="text-body inline-flex items-center gap-2">
        <input
          type="checkbox"
          checked={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="h-3.5 w-3.5 accent-accent"
        />
        <span className="text-text-muted">{value ? "true" : "false"}</span>
      </label>
    );
  }
  if (typeof value === "number") {
    return (
      <input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        disabled={disabled}
        onChange={(e) => {
          const n = e.target.value === "" ? 0 : Number(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        className="text-body-mono w-full rounded border border-border-subtle bg-surface px-2 py-1 text-text disabled:opacity-40"
      />
    );
  }
  const str = value == null ? "" : String(value);
  // Long values (JSON-ish or multi-line text) get a textarea automatically so
  // the user doesn't lose context behind a single-line scroll.
  if (str.length > 80 || str.includes("\n")) {
    return (
      <textarea
        value={str}
        rows={Math.min(8, Math.max(2, str.split("\n").length))}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="text-body-mono w-full resize-y rounded border border-border-subtle bg-surface px-2 py-1 text-text disabled:opacity-40"
      />
    );
  }
  return (
    <input
      type="text"
      value={str}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      placeholder={disabled ? "" : "—"}
      className="text-body-mono w-full rounded border border-border-subtle bg-surface px-2 py-1 text-text disabled:opacity-40"
    />
  );
}
