import { Folder, Loader2, RefreshCw, Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { AutocompleteInput, type GetSuggestions, type SuggestionItem } from "@/components/autocomplete-input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { RedisKey } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Types + colors
// ─────────────────────────────────────────────────────────────────────────────

const KEY_TYPE_COLORS: Record<string, string> = {
  string: "bg-violet-500/20 text-violet-300",
  list: "bg-green-500/20 text-green-300",
  hash: "bg-sky-500/20 text-sky-300",
  set: "bg-orange-500/20 text-orange-300",
  zset: "bg-yellow-500/20 text-yellow-300",
};

export function TypeBadge({ type }: { type: string }) {
  return (
    <span className={cn(
      "shrink-0 rounded px-1 py-px font-mono text-[9px] font-bold uppercase leading-none",
      KEY_TYPE_COLORS[type] ?? "bg-surface-active/50 text-text-muted",
    )}>
      {type}
    </span>
  );
}

export type TreeNode =
  | { kind: "key"; key: string; key_type: string; label: string }
  | { kind: "folder"; label: string; children: TreeNode[]; count: number };

function countLeaves(nodes: TreeNode[]): number {
  return nodes.reduce((s, n) => s + (n.kind === "key" ? 1 : n.count), 0);
}

function buildNodes(
  entries: { key: string; key_type: string; suffix: string }[],
  sep: string,
): TreeNode[] {
  const groups = new Map<string, typeof entries>();
  const leaves: typeof entries = [];

  for (const e of entries) {
    const idx = e.suffix.indexOf(sep);
    if (idx === -1) {
      leaves.push(e);
    } else {
      const seg = e.suffix.slice(0, idx);
      if (!groups.has(seg)) groups.set(seg, []);
      groups.get(seg)!.push({ ...e, suffix: e.suffix.slice(idx + sep.length) });
    }
  }

  const folders: TreeNode[] = [];
  for (const [label, children] of groups) {
    const childNodes = buildNodes(children, sep);
    folders.push({ kind: "folder", label, children: childNodes, count: countLeaves(childNodes) });
  }
  folders.sort((a, b) => a.label.localeCompare(b.label));

  const keyNodes: TreeNode[] = leaves
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((e) => ({ kind: "key", key: e.key, key_type: e.key_type, label: e.suffix }));

  return [...folders, ...keyNodes];
}

export function buildTree(keys: RedisKey[], sep = ":"): TreeNode[] {
  return buildNodes(keys.map((k) => ({ ...k, suffix: k.key })), sep);
}

function countActive(nodes: TreeNode[], activeKey: string): boolean {
  return nodes.some((n) =>
    n.kind === "key" ? n.key === activeKey : countActive(n.children, activeKey),
  );
}

export function buildKeyPatterns(keys: RedisKey[]): string[] {
  const patterns = new Set<string>();
  for (const { key } of keys) {
    const parts = key.split(":");
    const tpl = parts.map((p) => /^\d{6,}$/.test(p) ? "*" : p);

    for (let i = 1; i <= parts.length; i++) {
      patterns.add(parts.slice(0, i).join(":"));
    }
    for (let i = 1; i <= tpl.length; i++) {
      patterns.add(tpl.slice(0, i).join(":"));
    }
    for (let i = 1; i < tpl.length; i++) {
      patterns.add(tpl.slice(0, i).join(":") + ":*");
    }
    if (patterns.size > 4000) break;
  }
  return Array.from(patterns).sort();
}

export function buildKeySuggestions(patterns: string[]): GetSuggestions {
  return (value, cursorPos): { items: SuggestionItem[]; replaceStart: number; replaceEnd: number } => {
    const prefix = value.slice(0, cursorPos).toLowerCase();
    let matches: string[];
    if (prefix.includes("*") || prefix.includes("?")) {
      const re = new RegExp(
        "^" + prefix.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, "."),
        "i",
      );
      matches = patterns.filter((p) => re.test(p) && p.toLowerCase() !== prefix);
    } else {
      matches = patterns.filter((p) => p.toLowerCase().startsWith(prefix) && p.toLowerCase() !== prefix);
    }
    return {
      items: matches.slice(0, 12).map((p) => ({ label: p })),
      replaceStart: 0,
      replaceEnd: value.length,
    };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Row + Tree renderers
// ─────────────────────────────────────────────────────────────────────────────

function KeyRow({
  rkey,
  activeKey,
  onSelect,
  onPin,
  providerColor,
}: {
  rkey: RedisKey;
  activeKey: string;
  onSelect: (k: string) => void;
  onPin?: (k: string) => void;
  providerColor?: string;
}) {
  const active = activeKey === rkey.key;
  return (
    <button
      onClick={() => onSelect(rkey.key)}
      onDoubleClick={() => onPin?.(rkey.key)}
      className={cn(
        "flex w-full items-center gap-1.5 border-l-2 px-3 py-1.5 text-left text-body transition-all",
        active
          ? "bg-blue-500/10 text-blue-400 border-blue-500/30 shadow-inner"
          : "border-transparent text-text-muted hover:bg-surface-hover hover:text-text",
      )}
      style={active ? { borderColor: providerColor } : undefined}
    >
      <TypeBadge type={rkey.key_type} />
      <span className="truncate font-mono">{rkey.key}</span>
    </button>
  );
}

export function TreeNodeList({
  nodes,
  activeKey,
  onSelect,
  onPin,
  providerColor,
  depth,
  totalKeys,
}: {
  nodes: TreeNode[];
  activeKey: string;
  onSelect: (k: string) => void;
  onPin?: (k: string) => void;
  providerColor?: string;
  depth: number;
  totalKeys: number;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <FolderRow
            key={node.label + depth}
            node={node}
            activeKey={activeKey}
            onSelect={onSelect}
            onPin={onPin}
            providerColor={providerColor}
            depth={depth}
            totalKeys={totalKeys}
          />
        ) : (
          <button
            key={node.key}
            onClick={() => onSelect(node.key)}
            onDoubleClick={() => onPin?.(node.key)}
            className={cn(
              "flex w-full items-center gap-1.5 border-l-2 py-1.5 pr-3 text-left text-body transition-all",
              activeKey === node.key
                ? "bg-blue-500/10 text-blue-400 border-blue-500/30 shadow-inner"
                : "border-transparent text-text-muted hover:bg-surface-hover hover:text-text",
            )}
            style={{
              paddingLeft: depth * 10 + 8,
              ...(activeKey === node.key ? { borderColor: providerColor } : {}),
            }}
          >
            <TypeBadge type={node.key_type} />
            <span className="truncate font-mono">{node.label}</span>
          </button>
        ),
      )}
    </>
  );
}

function FolderRow({
  node,
  activeKey,
  onSelect,
  onPin,
  providerColor,
  depth,
  totalKeys,
}: {
  node: Extract<TreeNode, { kind: "folder" }>;
  activeKey: string;
  onSelect: (k: string) => void;
  onPin?: (k: string) => void;
  providerColor?: string;
  depth: number;
  totalKeys: number;
}) {
  const [open, setOpen] = useState(() => countActive(node.children, activeKey));
  const pct = totalKeys > 0 ? Math.round((node.count / totalKeys) * 100) : 0;
  const chevronRef = useRef<SVGSVGElement>(null);

  return (
    <div>
      <button
        onClick={() => setOpen((x) => !x)}
        className="flex w-full items-center gap-1.5 border-l-2 border-transparent py-1.5 pr-3 text-left text-body text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        style={{ paddingLeft: depth * 10 + 8 }}
      >
        <svg
          ref={chevronRef}
          viewBox="0 0 12 12"
          className={cn("h-3 w-3 shrink-0 text-text-faint transition-transform duration-100", open && "rotate-90")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M4 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <Folder className="h-3 w-3 shrink-0 text-text-faint" />
        <span className="min-w-0 flex-1 truncate font-mono">{node.label}</span>
        <span className="shrink-0 text-[10px] text-text-faint">{pct < 1 ? "<1" : pct}%</span>
        <span className="w-10 shrink-0 text-right font-mono text-[10px] text-text-faint">{node.count}</span>
      </button>
      {open && (
        <TreeNodeList
          nodes={node.children}
          activeKey={activeKey}
          onSelect={onSelect}
          onPin={onPin}
          providerColor={providerColor}
          depth={depth + 1}
          totalKeys={totalKeys}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter helper
// ─────────────────────────────────────────────────────────────────────────────

export function filterRedisKeys(keys: RedisKey[], search: string, typeFilter: string): RedisKey[] {
  let r = keys;
  if (search) {
    const q = search.toLowerCase();
    if (q.includes("*") || q.includes("?")) {
      const re = new RegExp(
        "^" + q.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
        "i",
      );
      r = r.filter((k) => re.test(k.key));
    } else {
      r = r.filter((k) => k.key.toLowerCase().includes(q));
    }
  }
  if (typeFilter !== "all") r = r.filter((k) => k.key_type === typeFilter);
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-contained Redis key navigator panel (used inside RedisLayout)
// ─────────────────────────────────────────────────────────────────────────────

export const TYPE_OPTIONS = [
  { value: "all", label: "All Key Types" },
  { value: "string", label: "String" },
  { value: "list", label: "List" },
  { value: "hash", label: "Hash" },
  { value: "set", label: "Set" },
  { value: "zset", label: "ZSet" },
];

export function RedisKeyNavigator({
  keys,
  loading,
  search,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  viewMode,
  onViewModeChange,
  databases,
  activeDb,
  onDbChange,
  loadingDbs,
  onReload,
  onSelectKey,
  onPinKey,
  activeKey,
  providerColor,
}: {
  keys: RedisKey[];
  loading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  typeFilter: string;
  onTypeFilterChange: (v: string) => void;
  viewMode: "list" | "tree";
  onViewModeChange: (v: "list" | "tree") => void;
  databases: string[];
  activeDb: string;
  onDbChange: (db: string) => void;
  loadingDbs: boolean;
  onReload: () => void;
  onSelectKey: (k: string) => void;
  onPinKey?: (k: string) => void;
  activeKey: string;
  providerColor?: string;
}) {
  const filteredKeys = useMemo(() => filterRedisKeys(keys, search, typeFilter), [keys, search, typeFilter]);
  const treeItems = useMemo(() => (viewMode === "tree" ? buildTree(filteredKeys) : []), [viewMode, filteredKeys]);
  const keyPatterns = useMemo(() => buildKeyPatterns(keys), [keys]);
  const getSuggestions = useMemo(() => buildKeySuggestions(keyPatterns), [keyPatterns]);

  return (
    <div className="flex h-full min-h-0 w-80 shrink-0 flex-col border-r border-border-subtle bg-surface/40">
      {/* DB picker + type filter + view mode */}
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border-subtle bg-surface/40 px-2 py-2">
        <div className="flex items-center gap-1.5">
          {loadingDbs ? (
            <Loader2 className="h-3 w-3 animate-spin text-text-faint" />
          ) : (
            <Select
              value={activeDb}
              onChange={onDbChange}
              options={databases.map((db) => ({ value: db, label: `db ${db}` }))}
              className="text-[11px] h-7 flex-1"
            />
          )}
          <div className="flex shrink-0 items-center gap-0.5 rounded border border-border-subtle bg-surface-sunken p-0.5 shadow-inner">
            <button
              onClick={() => onViewModeChange("list")}
              title="Lista"
              className={cn(
                "rounded p-0.5 transition-colors",
                viewMode === "list" ? "bg-surface-active text-text" : "text-text-faint hover:text-text-muted",
              )}
            >
              <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 3h8M2 6h8M2 9h8" strokeLinecap="round" />
              </svg>
            </button>
            <button
              onClick={() => onViewModeChange("tree")}
              title="Árbol"
              className={cn(
                "rounded p-0.5 transition-colors",
                viewMode === "tree" ? "bg-surface-active text-text" : "text-text-faint hover:text-text-muted",
              )}
            >
              <Folder className="h-3 w-3" />
            </button>
          </div>
        </div>

        <Select
          value={typeFilter}
          onChange={onTypeFilterChange}
          options={TYPE_OPTIONS}
          className="text-[11px] h-7"
        />

        <div className="flex items-center gap-1.5 rounded border border-border-subtle bg-surface-sunken px-2 py-1 shadow-inner">
          <Search className="h-3 w-3 shrink-0 text-text-faint" />
          <AutocompleteInput
            value={search}
            onChange={onSearchChange}
            getSuggestions={getSuggestions}
            placeholder="Search keys…"
            className="min-w-0 flex-1 bg-transparent text-body text-text placeholder:text-text-faint outline-none"
          />
          {search && (
            <button onClick={() => onSearchChange("")} className="shrink-0 text-text-faint hover:text-text-muted">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Results header */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border-subtle px-3">
        <span className="text-[10px] text-text-faint">
          Results: <span className="text-text-muted">{filteredKeys.length.toLocaleString()}</span>
        </span>
        <button
          onClick={onReload}
          disabled={loading}
          className="text-text-faint transition-colors hover:text-text-muted disabled:opacity-40"
          title="Recargar claves"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </button>
      </div>

      {/* Keys list / tree */}
      <div className="min-h-0 flex-1 overflow-y-auto py-0.5">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-text-faint" />
          </div>
        ) : (
          <>
            {viewMode === "list" && filteredKeys.map((rkey) => (
              <KeyRow
                key={rkey.key}
                rkey={rkey}
                activeKey={activeKey}
                onSelect={onSelectKey}
                onPin={onPinKey}
                providerColor={providerColor}
              />
            ))}

            {viewMode === "tree" && (
              <TreeNodeList
                nodes={treeItems}
                activeKey={activeKey}
                onSelect={onSelectKey}
                onPin={onPinKey}
                providerColor={providerColor}
                depth={0}
                totalKeys={keys.length}
              />
            )}

            {filteredKeys.length === 0 && (
              <div className="px-3 py-4 text-center text-body text-text-muted">
                {search || typeFilter !== "all" ? "Sin resultados." : "Sin claves en esta base de datos."}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
