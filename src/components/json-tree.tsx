import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type ParsedValue =
  | { kind: "null" }
  | { kind: "string"; v: string }
  | { kind: "number"; v: string }
  | { kind: "boolean"; v: string }
  | { kind: "objectid"; v: string }
  | { kind: "date"; v: string }
  | { kind: "object"; v: Record<string, unknown> }
  | { kind: "array"; v: unknown[] };

export function parseJsonValue(raw: unknown): ParsedValue {
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
  const p = parseJsonValue(raw);
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

export function JsonTree({ data, className }: { data: Record<string, unknown> | unknown[]; className?: string }) {
  const entries: [string, unknown][] = Array.isArray(data)
    ? data.map((v, i) => [String(i), v])
    : Object.entries(data);

  return (
    <div className={cn("font-mono text-body", className)}>
      {entries.map(([k, v]) => (
        <FieldRow key={k} fieldKey={k} raw={v} />
      ))}
    </div>
  );
}
