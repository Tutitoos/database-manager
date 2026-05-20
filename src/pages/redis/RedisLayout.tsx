import { invoke } from "@tauri-apps/api/core";
import { Folder, List, Loader2, RefreshCw, Search, X } from "lucide-react";
import { AutocompleteInput, type GetSuggestions, type SuggestionItem } from "@/components/autocomplete-input";
import { Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "@/lib/router-compat";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MetricsPanel } from "@/components/metrics-panel";
import RedisPubSubPage from "./RedisPubSubPage";
import { getProviderUi, ProviderIcon } from "@/lib/providers";
import { panel } from "@/lib/styles";
import type { Connection, RedisKey } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useSessionsStore, type RedisSession } from "@/store/sessions";
import { Select } from "@/components/ui/select";
import { PageHeader, SegmentedTabs } from "@/components/ui/page-header";
import { useInspectorContextFor } from "@/components/shell/InspectorContext";

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
      KEY_TYPE_COLORS[type] ?? "bg-surface-active/50 text-text-muted"
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
        "flex w-full items-center gap-1.5 border-l-2 px-3 py-1.5 text-left text-body transition-all",
        active
          ? "bg-blue-500/10 text-blue-400 border-blue-500/30 shadow-inner"
          : "border-transparent text-text-muted hover:bg-surface-hover hover:text-text"
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
              "flex w-full items-center gap-1.5 border-l-2 py-1.5 pr-3 text-left text-body transition-all",
              activeKey === node.key
                ? "bg-blue-500/10 text-blue-400 border-blue-500/30 shadow-inner"
                : "border-transparent text-text-muted hover:bg-surface-hover hover:text-text"
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
  const { t } = useTranslation();
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
    updateSession(connectionId, { keySearch, typeFilter, viewMode, activeDb, activeKey, activeView: view ?? "" });
  }, [keySearch, typeFilter, viewMode, activeDb, activeKey, view, connectionId]);

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

  useInspectorContextFor({
    connection,
    database: activeDb ? `DB ${activeDb}` : null,
    table: activeKey || null,
    tableLabel: "Key",
    extras: keys.length > 0
      ? [{ label: "Keys", value: <span className="text-text-muted">{keys.length}</span> }]
      : undefined,
  });

  const missingSession = !!connectionId && !sessions[connectionId];
  useEffect(() => {
    if (missingSession) navigate("/connections", { replace: true });
  }, [missingSession, navigate]);
  if (missingSession) return null;

  return (
    <div className={cn("flex min-w-0 flex-1 flex-col", panel)}>
      <PageHeader
        left={
          connection && provider ? (
            <div className="flex items-center gap-2">
              <span className="shrink-0 h-5 w-5 overflow-hidden rounded-sm border border-border-subtle">
                <ProviderIcon providerId={connection.plugin_id} className="block h-full w-full object-cover" />
              </span>
              <span className="text-h3 font-medium text-text">{connection.name}</span>
              <span className="text-body text-text-muted">{connection.host}:{connection.port ?? "-"}</span>
            </div>
          ) : null
        }
        right={
          <SegmentedTabs
            value={view === "metrics" ? "metrics" : view === "pubsub" ? "pubsub" : "data"}
            onChange={(v) => navView(v as "data" | "metrics" | "pubsub")}
            options={[
              { value: "data", label: t("common.data") },
              { value: "pubsub", label: "Pub/Sub" },
              { value: "metrics", label: t("common.metrics") },
            ]}
          />
        }
      />

      {view === "metrics" && connection && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <MetricsPanel connection={connection} database={activeDb} pubsubChannels={stored?.pubsubChannels ?? []} />
        </div>
      )}

      {view === "pubsub" && connection && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <RedisPubSubPage connection={connection} />
        </div>
      )}

      {view !== "metrics" && view !== "pubsub" && <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface/40 px-4">
        <Select
          value={typeFilter}
          onChange={setTypeFilter}
          options={TYPE_OPTIONS}
          className="text-[11px] h-8"
        />

        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border-subtle bg-surface-sunken px-2.5 py-1.5 transition-colors focus-within:border-border-strong focus-within:ring-1 focus-within:ring-accent-ring shadow-inner">
          <Search className="h-3 w-3 shrink-0 text-text-faint" />
          <AutocompleteInput
            value={keySearch}
            onChange={setKeySearch}
            getSuggestions={getKeySuggestions}
            placeholder="Search by Key Name or Pattern..."
            className="min-w-0 flex-1 bg-transparent text-body text-text placeholder:text-text-faint outline-none"
          />
          {keySearch && (
            <button onClick={() => setKeySearch("")} className="shrink-0 text-text-faint transition-colors hover:text-text-muted">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border-subtle bg-surface-sunken p-1 shadow-inner">
          <button onClick={() => setViewMode("list")} title="Lista" className={cn("rounded p-0.5 transition-colors", viewMode === "list" ? "bg-surface-active text-text" : "text-text-faint hover:text-text-muted")}>
            <List className="h-3 w-3" />
          </button>
          <button onClick={() => setViewMode("tree")} title="Árbol" className={cn("rounded p-0.5 transition-colors", viewMode === "tree" ? "bg-surface-active text-text" : "text-text-faint hover:text-text-muted")}>
            <Folder className="h-3 w-3" />
          </button>
        </div>

        <div className="h-4 w-px bg-surface-hover" />

        {loadingDbs ? (
          <Loader2 className="h-3 w-3 animate-spin text-text-faint" />
        ) : (
          <Select
            value={activeDb}
            onChange={selectDb}
            options={databases.map((db) => ({ value: db, label: `db ${db}` }))}
            className="text-[11px] h-8"
          />
        )}
      </div>}

      {view !== "metrics" && view !== "pubsub" && <div className="flex min-h-0 flex-1 bg-black/20">
        <div className="flex w-80 shrink-0 flex-col border-r border-border-subtle bg-surface/50">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-subtle px-4 bg-white/[0.01]">
            <span className="text-[10px] text-text-faint">
              Results: <span className="text-text-muted">{filteredKeys.length.toLocaleString()}</span>
            </span>
            <button
              onClick={reloadKeys}
              disabled={loadingKeys}
              className="text-text-faint transition-colors hover:text-text-muted disabled:opacity-40"
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
              <div className="px-3 py-4 text-center text-body text-text-muted">
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
