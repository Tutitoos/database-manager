
import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronLeft, ChevronRight, Copy, FileText, Loader2, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "@/lib/router-compat";
import { useSessionsStore, type DocumentSession } from "@/store/sessions";
import { mutedText, sectionBorder, surface } from "@/lib/styles";
import type { Connection, DocumentResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AutocompleteInput, getWordAtPos, type GetSuggestions, type SuggestionItem, type SuggestionResult } from "@/components/autocomplete-input";
import { Modal } from "@/components/modal";
import { CodeEditor } from "@/components/code-editor";
import { QueryTimings, type TimingEntry } from "@/components/query-timings";
import { useVirtualizer } from "@tanstack/react-virtual";

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
  null: "text-text-faint",
  string: "text-green-400",
  number: "text-blue-400",
  boolean: "text-blue-400",
  objectid: "text-red-400",
  date: "text-cyan-400",
  object: "text-text-faint",
  array: "text-text-faint",
};

const TYPE_HINT_COLOR: Record<string, string> = {
  null: "text-text-faint",
  string: "text-green-600",
  number: "text-blue-600",
  boolean: "text-blue-600",
  objectid: "text-red-600",
  date: "text-cyan-600",
  object: "text-text-faint",
  array: "text-text-faint",
};

function InlineValue({ p }: { p: ParsedValue }) {
  const color = KIND_COLOR[p.kind] ?? "text-text";
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
          <button onClick={() => setOpen((x) => !x)} className="shrink-0 text-text-faint transition-colors hover:text-text">
            <ChevronRight className={cn("h-3 w-3 transition-transform duration-100", open && "rotate-90")} />
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="text-text">{fieldKey}</span>
        <span className="text-text-faint"> : </span>
        <InlineValue p={p} />
      </div>
      {nested && open && entries.map(([k, v]) => (
        <FieldRow key={k} fieldKey={k} raw={v} depth={depth + 1} />
      ))}
    </div>
  );
}

const TYPE_BADGE: Record<string, { fg: string; bg: string; ring: string; short: string }> = {
  string:   { fg: "text-green-300",  bg: "bg-green-500/15",  ring: "ring-green-500/30",  short: "str" },
  number:   { fg: "text-blue-300",   bg: "bg-blue-500/15",   ring: "ring-blue-500/30",   short: "num" },
  boolean:  { fg: "text-sky-300",    bg: "bg-sky-500/15",    ring: "ring-sky-500/30",    short: "bool" },
  objectid: { fg: "text-red-300",    bg: "bg-red-500/15",    ring: "ring-red-500/30",    short: "oid" },
  date:     { fg: "text-cyan-300",   bg: "bg-cyan-500/15",   ring: "ring-cyan-500/30",   short: "date" },
  object:   { fg: "text-violet-300", bg: "bg-violet-500/15", ring: "ring-violet-500/30", short: "obj" },
  array:    { fg: "text-amber-300",  bg: "bg-amber-500/15",  ring: "ring-amber-500/30",  short: "arr" },
  null:     { fg: "text-text-muted",   bg: "bg-zinc-500/15",   ring: "ring-accent-ring",   short: "null" },
};

function TypeBadge({ kind }: { kind: string }) {
  const k = TYPE_BADGE[kind] ?? TYPE_BADGE.string;
  return (
    <span
      className={cn(
        "inline-flex h-4 items-center rounded-full px-1.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ring-inset",
        k.fg,
        k.bg,
        k.ring,
      )}
    >
      {k.short}
    </span>
  );
}

function ActionIconBtn({
  children,
  onClick,
  title,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={cn(
        "rounded p-1 text-text-muted transition-colors disabled:cursor-not-allowed disabled:opacity-30",
        !disabled && (danger ? "hover:bg-red-950/60 hover:text-red-300" : "hover:bg-surface-hover hover:text-text"),
      )}
    >
      {children}
    </button>
  );
}

function extractDocumentId(id: unknown): string | null {
  if (id === undefined || id === null) return null;
  if (typeof id === "string") return id;
  if (typeof id === "number") return String(id);
  if (typeof id === "object") {
    const o = id as Record<string, unknown>;
    if (typeof o.$oid === "string") return o.$oid;
    if (o.$numberLong !== undefined) return String(o.$numberLong);
  }
  return null;
}

function DocumentCard({
  doc,
  onEdit,
  onDelete,
}: {
  doc: Record<string, unknown>;
  onEdit?: (id: string, doc: Record<string, unknown>) => void;
  onDelete?: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const id = doc._id;
  const docId = extractDocumentId(id);
  const rest = Object.entries(doc).filter(([k]) => k !== "_id");

  function copyDoc() {
    navigator.clipboard.writeText(JSON.stringify(doc, null, 2)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group rounded border border-border-subtle bg-surface/60 font-mono text-body">
      <div className="flex items-start gap-2 px-3 py-2">
        <button onClick={() => setCollapsed((x) => !x)} className="mt-0.5 shrink-0 text-text-faint transition-colors hover:text-text">
          <ChevronRight className={cn("h-3 w-3 transition-transform duration-100", !collapsed && "rotate-90")} />
        </button>
        <div className="min-w-0 flex-1">
          {id !== undefined && (
            <div className="flex items-center gap-1">
              <span className="text-text">_id</span>
              <span className="text-text-faint"> : </span>
              <InlineValue p={parse(id)} />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-transparent bg-surface-elevated/0 p-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-hover:border-border-subtle group-hover:bg-surface-elevated/60">
          <ActionIconBtn
            disabled={!docId || !onEdit}
            onClick={() => docId && onEdit?.(docId, doc)}
            title={docId ? "Editar documento" : "Sin _id editable"}
          >
            <Pencil className="h-3 w-3" />
          </ActionIconBtn>
          <ActionIconBtn onClick={copyDoc} title="Copiar JSON">
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          </ActionIconBtn>
          <ActionIconBtn
            disabled={!docId || !onDelete}
            onClick={() => docId && onDelete?.(docId)}
            title={docId ? "Eliminar documento" : "Sin _id eliminable"}
            danger
          >
            <Trash2 className="h-3 w-3" />
          </ActionIconBtn>
        </div>
      </div>
      {!collapsed && rest.length > 0 && (
        <div className="border-t border-border-subtle/50 px-3 py-2">
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
      color: TYPE_HINT_COLOR[kind] ?? "text-text-faint",
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
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const connectionId = Number(searchParams.get("id"));
  const db = searchParams.get("db") ?? "";
  const collection = searchParams.get("collection") ?? "";

  const [connection, setConnection] = useState<Connection | null>(null);
  const [result, setResult] = useState<DocumentResult | null>(null);
  const [prevQueryMs, setPrevQueryMs] = useState<number | null>(null);
  const [renderMs, setRenderMs] = useState<number | null>(null);
  const [timingHistory, setTimingHistory] = useState<TimingEntry[]>([]);
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
  const [editorState, setEditorState] = useState<{ id: string; json: string; error: string | null; saving: boolean } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: result?.documents.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 92,
    overscan: 6,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  function openDocumentEditor(id: string, doc: Record<string, unknown>) {
    setEditorState({
      id,
      json: JSON.stringify(doc, null, 2),
      error: null,
      saving: false,
    });
  }

  function confirmDeleteDocument(id: string) {
    setDeletingId(id);
  }

  async function performDelete() {
    if (!connection || !deletingId) return;
    try {
      await invoke("delete_document", {
        input: connection,
        database: db,
        collection,
        documentId: deletingId,
      });
      setDeletingId(null);
      setFetchKey((k) => k + 1);
    } catch (e) {
      setError(String(e));
      setDeletingId(null);
    }
  }

  async function performEditSave() {
    if (!connection || !editorState) return;
    try {
      JSON.parse(editorState.json);
    } catch (e) {
      setEditorState({ ...editorState, error: "JSON inválido" });
      return;
    }
    setEditorState({ ...editorState, error: null, saving: true });
    try {
      await invoke("update_document", {
        input: connection,
        database: db,
        collection,
        documentId: editorState.id,
        updateJson: editorState.json,
      });
      setEditorState(null);
      setFetchKey((k) => k + 1);
    } catch (e) {
      setEditorState({ ...editorState, error: String(e), saving: false });
    }
  }

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
    const t0 = performance.now();
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
        const totalMs = performance.now() - t0;
        const queryMs = res.query_ms ?? 0;
        const rMs = Math.max(0, totalMs - queryMs);
        setPrevQueryMs(result?.query_ms ?? null);
        setResult(res);
        setRenderMs(rMs);
        setTimingHistory((prev) => {
          const next = [
            ...prev,
            { queryMs, renderMs: rMs, totalMs, at: Date.now(), label: `${collection} · pg ${stackIdx + 1}` },
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
        <div className="grid h-16 w-16 w-16 place-items-center rounded-2xl border border-border-subtle bg-surface-elevated/50 text-text-muted shadow-2xl backdrop-blur-sm relative">
          <FileText className="h-8 w-8 text-blue-400/50" />
        </div>
        <h2 className="mt-6 text-h2 font-medium text-text relative">{t("documentPage.selectCollection")}</h2>
        <p className="mt-2 max-w-sm text-h3 text-text-faint relative">
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
            "flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-surface/60 px-2.5 py-1.5 transition-colors",
            filterFocused ? "border-border-strong" : "border-border-subtle",
            filterError ? "border-red-500/50" : ""
          )}>
            <AutocompleteInput
              value={filterInput}
              onChange={(v) => { setFilterInput(v); setFilterError(null); }}
              onSubmit={applyFilter}
              getSuggestions={getSuggestions}
              placeholder='{ "active": true, "plan_type": "server" }'
              className="min-w-0 flex-1 bg-transparent font-mono text-body text-text placeholder-zinc-700 outline-none"
              onFocusChange={setFilterFocused}
            />
            {filterInput && (
              <button onClick={() => { setFilterInput(""); setFilterError(null); }} className="shrink-0 text-text-faint transition-colors hover:text-text-muted">
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
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-hover px-3 py-1.5 text-[10px] font-medium text-text transition-all hover:border-border-strong hover:bg-surface-active hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
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
          <div className="flex items-center gap-1 overflow-x-auto px-3 pb-2 scrollbar-none">
            <span className="shrink-0 pr-1 text-[10px] uppercase tracking-wider text-text-faint">Campos</span>
            <span className="mx-1 h-3 w-px shrink-0 bg-surface-hover" />
            {fieldSuggestions.map(({ label, hint }) => (
              <button
                key={label}
                onClick={() => insertField(label)}
                title={`${label} · ${hint ?? "?"}`}
                className="group/chip flex shrink-0 items-center gap-1.5 rounded-full border border-border-subtle bg-surface-elevated/40 py-0.5 pl-2 pr-1 transition-all hover:border-border-strong hover:bg-surface-hover/70"
              >
                <span className="font-mono text-[10.5px] text-text transition-colors group-hover/chip:text-text">
                  {label}
                </span>
                {hint && <TypeBadge kind={hint} />}
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
        <span className="text-body text-text-faint">{db}</span>
        <span className="text-body text-text-faint">/</span>
        <span className="text-body font-medium text-text">{collection}</span>
        {result && (
          <span className="ml-1 rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-text-muted">
            {result.total.toLocaleString()} documentos
          </span>
        )}
        {result?.query_ms != null && !loading && (
          <QueryTimings queryMs={result.query_ms} renderMs={renderMs} history={timingHistory} />
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-text-faint" />}
          <button
            onClick={retry}
            disabled={loading}
            title="Actualizar"
            className="rounded p-1 text-text-faint transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-40"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-3">
        {error && (
          <div className="mb-2 flex items-center gap-3 p-2 text-body text-red-400">
            <span>{error}</span>
            <button
              onClick={retry}
              className="rounded border border-red-500/30 px-2 py-1 transition-colors hover:bg-red-500/10"
            >
              Reintentar
            </button>
          </div>
        )}
        {result && result.documents.length > 0 && (
          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}
          >
            {virtualizer.getVirtualItems().map((v) => {
              const doc = result.documents[v.index];
              return (
                <div
                  key={v.key}
                  data-index={v.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${v.start}px)`,
                    paddingBottom: 6,
                  }}
                >
                  <DocumentCard
                    doc={doc}
                    onEdit={connection ? (id, current) => openDocumentEditor(id, current) : undefined}
                    onDelete={connection ? (id) => confirmDeleteDocument(id) : undefined}
                  />
                </div>
              );
            })}
          </div>
        )}
        {!loading && result && result.documents.length === 0 && (
          <div className={cn("p-8 text-center text-body", mutedText)}>Sin documentos</div>
        )}
      </div>

      <div className={cn("flex h-10 shrink-0 items-center justify-between border-t px-4", sectionBorder)}>
        <button
          onClick={prevPage}
          disabled={stackIdx === 0 || loading}
          className="flex items-center gap-1 rounded px-2 py-1 text-body text-text-muted transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Anterior
        </button>

        <div className="flex items-center gap-2">
          {loading && (
            <button
              onClick={cancelRequest}
              className="flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface-hover px-2.5 py-1 text-[10px] text-text-muted transition-all hover:border-red-500/40 hover:text-red-400"
            >
              <X className="h-3 w-3" />
              Cancelar
            </button>
          )}
          <span className="text-body text-text-faint">Página {pageNum}</span>
        </div>

        <button
          onClick={nextPage}
          disabled={!result?.next_cursor || loading}
          className="flex items-center gap-1 rounded px-2 py-1 text-body text-text-muted transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-30"
        >
          Siguiente
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {editorState && (
        <Modal onClose={() => !editorState.saving && setEditorState(null)}>
          <div className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-md border border-border-subtle bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
              <h2 className="text-h3 font-medium text-text">{t("documentPage.editDocument")}</h2>
              <button
                className="rounded p-1 text-text-faint hover:bg-surface-hover hover:text-text"
                onClick={() => setEditorState(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-[50vh] flex-1 overflow-auto bg-surface">
              <CodeEditor
                lang="json"
                value={editorState.json}
                onChange={(v) => setEditorState({ ...editorState, json: v, error: null })}
                minHeight="50vh"
              />
            </div>
            {editorState.error && (
              <div className="border-t border-red-900/40 bg-red-950/30 px-4 py-2 text-body text-red-300">{editorState.error}</div>
            )}
            <div className="flex justify-end gap-2 border-t border-border-subtle px-4 py-3">
              <button
                className="rounded border border-border-strong px-3 py-1.5 text-body text-text hover:bg-surface-hover"
                onClick={() => setEditorState(null)}
                disabled={editorState.saving}
              >
                Cancelar
              </button>
              <button
                className="rounded bg-emerald-600 px-3 py-1.5 text-body font-medium text-text hover:bg-emerald-500 disabled:opacity-50"
                onClick={performEditSave}
                disabled={editorState.saving}
              >
                {editorState.saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {deletingId && (
        <Modal onClose={() => setDeletingId(null)}>
          <div className="w-full max-w-md rounded-md border border-border-subtle bg-surface p-5 shadow-xl">
            <h2 className="text-h3 font-medium text-text">¿Eliminar documento?</h2>
            <p className="mt-2 text-body text-text-muted">Esta acción no se puede deshacer.</p>
            <p className="mt-2 break-all rounded bg-surface-elevated px-2 py-1 font-mono text-[11px] text-text">_id: {deletingId}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded border border-border-strong px-3 py-1.5 text-body text-text hover:bg-surface-hover"
                onClick={() => setDeletingId(null)}
              >
                Cancelar
              </button>
              <button
                className="rounded bg-red-600 px-3 py-1.5 text-body font-medium text-text hover:bg-red-500"
                onClick={performDelete}
              >
                Eliminar
              </button>
            </div>
          </div>
        </Modal>
      )}
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
