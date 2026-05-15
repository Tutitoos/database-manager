import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, BarChart2, Database, Folder, List, Loader2, Radio, RefreshCw, Search, X } from "lucide-react";
import { AutocompleteInput, type GetSuggestions, type SuggestionItem } from "@/components/autocomplete-input";
import { Link, Outlet, useNavigate, useSearchParams } from "react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MetricsPanel } from "@/components/metrics-panel";
import RedisPubSubPage from "./RedisPubSubPage";
import { getProviderUi, ProviderIcon } from "@/lib/providers";
import { mutedText, panel, sectionBorder } from "@/lib/styles";
import type { Connection, RedisKey } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useSessionsStore, type RedisSession } from "@/store/sessions";

const KEY_TYPE_COLORS: Record<string, string> = {
  string: "bg-violet-500/20 text-violet-300",
  list: "bg-green-500/20 text-green-300",
  hash: "bg-sky-500/20 text-sky-300",
  set: "bg-orange-500/20 text-orange-300",
  zset: "bg-yellow-500/20 text-yellow-300",
};

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={cn(
      "shrink-0 rounded px-1 py-px font-mono text-[9px] font-bold uppercase leading-none",
      KEY_TYPE_COLORS[type] ?? "bg-zinc-700/50 text-zinc-400"
    )}>
      {type}
    </span>
  );
}

type TreeNode =
  | { kind: "key"; key: string; key_type: string; label: string }
  | { kind: "folder"; label: string; children: TreeNode[]; count: number };

function countLeaves(nodes: TreeNode[]): number {
  return nodes.reduce((s, n) => s + (n.kind === "key" ? 1 : n.count), 0);
}

function buildNodes(
  entries: { key: string; key_type: string; suffix: string }[],
  sep: string
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

function buildTree(keys: RedisKey[], sep = ":"): TreeNode[] {
  return buildNodes(keys.map((k) => ({ ...k, suffix: k.key })), sep);
}

function countActive(nodes: TreeNode[], activeKey: string): boolean {
  return nodes.some((n) =>
    n.kind === "key" ? n.key === activeKey : countActive(n.children, activeKey)
  );
}

function KeyRow({
  rkey,
  activeKey,
  onSelect,
  providerColor,
}: {
  rkey: RedisKey;
  activeKey: string;
  onSelect: (k: string) => void;
  providerColor?: string;
}) {
  const active = activeKey === rkey.key;
  return (
    <button
      onClick={() => onSelect(rkey.key)}
      className={cn(
        "flex w-full items-center gap-1.5 border-l-2 px-2 py-1 text-left text-xs transition-colors",
        active ? "bg-zinc-900/60 text-white" : "border-transparent text-zinc-500 hover:bg-zinc-900/50 hover:text-zinc-300"
      )}
      style={active ? { borderColor: providerColor } : undefined}
    >
      <TypeBadge type={rkey.key_type} />
      <span className="truncate font-mono">{rkey.key}</span>
    </button>
  );
}

function TreeNodeList({
  nodes,
  activeKey,
  onSelect,
  providerColor,
  depth,
  totalKeys,
}: {
  nodes: TreeNode[];
  activeKey: string;
  onSelect: (k: string) => void;
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
            providerColor={providerColor}
            depth={depth}
            totalKeys={totalKeys}
          />
        ) : (
          <button
            key={node.key}
            onClick={() => onSelect(node.key)}
            className={cn(
              "flex w-full items-center gap-1.5 border-l-2 py-1 pr-2 text-left text-xs transition-colors",
              activeKey === node.key
                ? "bg-zinc-900/60 text-white"
                : "border-transparent text-zinc-500 hover:bg-zinc-900/50 hover:text-zinc-300"
            )}
            style={{
              paddingLeft: depth * 10 + 8,
              ...(activeKey === node.key ? { borderColor: providerColor } : {}),
            }}
          >
            <TypeBadge type={node.key_type} />
            <span className="truncate font-mono">{node.label}</span>
          </button>
        )
      )}
    </>
  );
}

function FolderRow({
  node,
  activeKey,
  onSelect,
  providerColor,
  depth,
  totalKeys,
}: {
  node: Extract<TreeNode, { kind: "folder" }>;
  activeKey: string;
  onSelect: (k: string) => void;
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
        className="flex w-full items-center gap-1.5 border-l-2 border-transparent py-1 pr-2 text-left text-xs text-zinc-400 transition-colors hover:bg-zinc-900/50 hover:text-zinc-300"
        style={{ paddingLeft: depth * 10 + 8 }}
      >
        <svg
          ref={chevronRef}
          viewBox="0 0 12 12"
          className={cn("h-3 w-3 shrink-0 text-zinc-600 transition-transform duration-100", open && "rotate-90")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M4 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <Folder className="h-3 w-3 shrink-0 text-zinc-600" />
        <span className="min-w-0 flex-1 truncate font-mono">{node.label}</span>
        <span className="shrink-0 text-[10px] text-zinc-600">{pct < 1 ? "<1" : pct}%</span>
        <span className="w-10 shrink-0 text-right font-mono text-[10px] text-zinc-500">{node.count}</span>
      </button>
      {open && (
        <TreeNodeList
          nodes={node.children}
          activeKey={activeKey}
          onSelect={onSelect}
          providerColor={providerColor}
          depth={depth + 1}
          totalKeys={totalKeys}
        />
      )}
    </div>
  );
}

function buildKeyPatterns(keys: RedisKey[]): string[] {
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

function buildKeySuggestions(patterns: string[]): GetSuggestions {
  return (value, cursorPos): { items: SuggestionItem[]; replaceStart: number; replaceEnd: number } => {
    const prefix = value.slice(0, cursorPos).toLowerCase();
    let matches: string[];
    if (prefix.includes("*") || prefix.includes("?")) {
      const re = new RegExp(
        "^" + prefix.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, "."),
        "i"
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

const TYPE_OPTIONS = [
  { value: "all", label: "All Key Types" },
  { value: "string", label: "String" },
  { value: "list", label: "List" },
  { value: "hash", label: "Hash" },
  { value: "set", label: "Set" },
  { value: "zset", label: "ZSet" },
];

export default function RedisLayout() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const connectionId = Number(searchParams.get("id"));
  const activeDb = searchParams.get("db") ?? "0";
  const activeKey = searchParams.get("key") ?? "";
  const view = searchParams.get("view");

  const { sessions, updateSession } = useSessionsStore();
  const stored = sessions[connectionId] as RedisSession | undefined;

  const [connection, setConnection] = useState<Connection | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  const [keys, setKeys] = useState<RedisKey[]>([]);
  const [keySearch, setKeySearch] = useState(() => stored?.keySearch ?? "");
  const [typeFilter, setTypeFilter] = useState(() => stored?.typeFilter ?? "all");
  const [viewMode, setViewMode] = useState<"list" | "tree">(() => stored?.viewMode ?? "tree");
  const [loadingDbs, setLoadingDbs] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState(false);

  useEffect(() => {
    if (!connectionId) return;
    updateSession(connectionId, { keySearch, typeFilter, viewMode });
  }, [keySearch, typeFilter, viewMode]);

  useEffect(() => {
    invoke<Connection[]>("list_connections").then((all) => {
      setConnection(all.find((c) => c.id === connectionId) ?? null);
    });
  }, [connectionId]);

  useEffect(() => {
    if (!connection) return;
    setLoadingDbs(true);
    invoke<string[]>("list_databases", { input: connection })
      .then(setDatabases)
      .catch(() => setDatabases([]))
      .finally(() => setLoadingDbs(false));
  }, [connection]);

  const reloadKeys = useCallback(() => {
    if (!connection) return;
    setLoadingKeys(true);
    setKeys([]);
    invoke<RedisKey[]>("list_redis_keys", { input: connection, database: activeDb })
      .then(setKeys)
      .catch(() => setKeys([]))
      .finally(() => setLoadingKeys(false));
  }, [connection, activeDb]);

  useEffect(() => { reloadKeys(); }, [reloadKeys]);

  function selectDb(db: string) {
    const params = view === "metrics"
      ? `/connections/redis?id=${connectionId}&db=${encodeURIComponent(db)}&view=metrics`
      : `/connections/redis?id=${connectionId}&db=${encodeURIComponent(db)}`;
    navigate(params);
  }

  function selectKey(key: string) {
    navigate(`/connections/redis?id=${connectionId}&db=${encodeURIComponent(activeDb)}&key=${encodeURIComponent(key)}`);
  }

  function navView(target: "data" | "metrics" | "pubsub") {
    if (target === "metrics") {
      navigate(`/connections/redis?id=${connectionId}&db=${encodeURIComponent(activeDb)}&view=metrics`);
    } else if (target === "pubsub") {
      navigate(`/connections/redis?id=${connectionId}&db=${encodeURIComponent(activeDb)}&view=pubsub`);
    } else {
      navigate(`/connections/redis?id=${connectionId}&db=${encodeURIComponent(activeDb)}`);
    }
  }

  const provider = connection ? getProviderUi(connection.plugin_id) : null;

  const filteredKeys = useMemo(() => {
    let r = keys;
    if (keySearch) {
      const q = keySearch.toLowerCase();
      if (q.includes("*") || q.includes("?")) {
        const re = new RegExp(
          "^" + q.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
          "i"
        );
        r = r.filter((k) => re.test(k.key));
      } else {
        r = r.filter((k) => k.key.toLowerCase().includes(q));
      }
    }
    if (typeFilter !== "all") r = r.filter((k) => k.key_type === typeFilter);
    return r;
  }, [keys, keySearch, typeFilter]);

  const treeItems: TreeNode[] = useMemo(
    () => viewMode === "tree" ? buildTree(filteredKeys) : [],
    [viewMode, filteredKeys]
  );

  const keyPatterns = useMemo(() => buildKeyPatterns(keys), [keys]);
  const getKeySuggestions = useMemo(() => buildKeySuggestions(keyPatterns), [keyPatterns]);

  return (
    <div className={cn("flex min-w-0 flex-1 flex-col", panel)}>
      <header className={cn("flex h-12 shrink-0 items-center gap-3 border-b px-4", panel, sectionBorder)}>
        <Link to="/connections" className="flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-200">
          <ArrowLeft className="h-3.5 w-3.5" />
          Conexiones
        </Link>
        <span className="text-zinc-700">/</span>
        {connection && provider && (
          <div className="flex items-center gap-2">
            <span className="shrink-0 h-5 w-5 overflow-hidden rounded border border-white/10 shadow-inner">
              <ProviderIcon providerId={connection.plugin_id} className="block h-full w-full object-cover" />
            </span>
            <span className="text-sm font-medium text-white">{connection.name}</span>
            <span className={cn("text-xs", mutedText)}>{connection.host}:{connection.port ?? "-"}</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={() => navView("data")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              view !== "metrics" && view !== "pubsub" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300"
            )}
          >
            <Database className="h-3.5 w-3.5" />
            Datos
          </button>
          <button
            onClick={() => navView("pubsub")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              view === "pubsub" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300"
            )}
          >
            <Radio className="h-3.5 w-3.5" />
            Pub/Sub
          </button>
          <button
            onClick={() => navView("metrics")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              view === "metrics" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300"
            )}
          >
            <BarChart2 className="h-3.5 w-3.5" />
            Métricas
          </button>
        </div>
      </header>

      {view === "metrics" && connection && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <MetricsPanel connection={connection} database={activeDb} />
        </div>
      )}

      {view === "pubsub" && connection && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <RedisPubSubPage connection={connection} />
        </div>
      )}

      {view !== "metrics" && view !== "pubsub" && <div className={cn("flex h-10 shrink-0 items-center gap-1.5 border-b px-3", sectionBorder)}>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="shrink-0 rounded border border-zinc-700/60 bg-zinc-800/60 px-2 py-1 text-[10px] text-zinc-300 outline-none transition-colors hover:border-zinc-600 focus:border-zinc-500"
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded border border-zinc-800/60 bg-zinc-900/40 px-2 py-1 transition-colors focus-within:border-zinc-600">
          <Search className="h-3 w-3 shrink-0 text-zinc-600" />
          <AutocompleteInput
            value={keySearch}
            onChange={setKeySearch}
            getSuggestions={getKeySuggestions}
            placeholder="Filter by Key Name or Pattern..."
            className="min-w-0 flex-1 bg-transparent text-xs text-zinc-300 placeholder-zinc-600 outline-none"
          />
          {keySearch && (
            <button onClick={() => setKeySearch("")} className="shrink-0 text-zinc-600 transition-colors hover:text-zinc-400">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 rounded border border-zinc-800 p-0.5">
          <button onClick={() => setViewMode("list")} title="Lista" className={cn("rounded p-0.5 transition-colors", viewMode === "list" ? "bg-zinc-700 text-white" : "text-zinc-600 hover:text-zinc-400")}>
            <List className="h-3 w-3" />
          </button>
          <button onClick={() => setViewMode("tree")} title="Árbol" className={cn("rounded p-0.5 transition-colors", viewMode === "tree" ? "bg-zinc-700 text-white" : "text-zinc-600 hover:text-zinc-400")}>
            <Folder className="h-3 w-3" />
          </button>
        </div>

        <div className="h-4 w-px bg-zinc-800" />

        {loadingDbs ? (
          <Loader2 className="h-3 w-3 animate-spin text-zinc-600" />
        ) : (
          <select
            value={activeDb}
            onChange={(e) => selectDb(e.target.value)}
            className="rounded border border-zinc-700/60 bg-zinc-800/60 px-2 py-1 text-[10px] text-zinc-300 outline-none transition-colors hover:border-zinc-600 focus:border-zinc-500"
          >
            {databases.map((db) => (
              <option key={db} value={db}>db {db}</option>
            ))}
          </select>
        )}
      </div>}

      {view !== "metrics" && view !== "pubsub" && <div className="flex min-h-0 flex-1">
        <div className={cn("flex w-105 shrink-0 flex-col border-r", sectionBorder)}>
          <div className={cn("flex h-7 shrink-0 items-center justify-between border-b px-3", sectionBorder)}>
            <span className="text-[10px] text-zinc-500">
              Results: <span className="text-zinc-400">{filteredKeys.length.toLocaleString()}</span>
            </span>
            <button
              onClick={reloadKeys}
              disabled={loadingKeys}
              className="text-zinc-600 transition-colors hover:text-zinc-400 disabled:opacity-40"
              title="Recargar claves"
            >
              {loadingKeys
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <RefreshCw className="h-3 w-3" />
              }
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto py-0.5">
            {viewMode === "list" && filteredKeys.map((rkey) => (
              <KeyRow key={rkey.key} rkey={rkey} activeKey={activeKey} onSelect={selectKey} providerColor={provider?.color} />
            ))}

            {viewMode === "tree" && (
              <TreeNodeList
                nodes={treeItems}
                activeKey={activeKey}
                onSelect={selectKey}
                providerColor={provider?.color}
                depth={0}
                totalKeys={keys.length}
              />
            )}

            {!loadingKeys && filteredKeys.length === 0 && (
              <div className={cn("px-3 py-4 text-center text-xs", mutedText)}>
                {keySearch || typeFilter !== "all" ? "Sin resultados." : "Sin claves en esta base de datos."}
              </div>
            )}
          </div>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
      </div>}
    </div>
  );
}
