import { Store } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";
import { invoke } from "@tauri-apps/api/core";
import type { Connection } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Workspace tabs
// ─────────────────────────────────────────────────────────────────────────────

export type WorkspaceTabKind = "entity" | "query" | "channel" | "view";

export interface WorkspaceTabBase {
  id: string;
  title: string;
  ephemeral: boolean;
  pinned: boolean;
  createdAt: number;
}

export interface EntityTab extends WorkspaceTabBase {
  kind: "entity";
  /** Sub-kind drives the renderer dispatcher. */
  entityKind: "table" | "collection" | "key";
  db: string;
  name: string;
}

export interface QueryTab extends WorkspaceTabBase {
  kind: "query";
  db?: string;
  /** Stable script id (also lives in `SqlSession.queryScripts` for content). */
  scriptId: string;
}

export interface ChannelTab extends WorkspaceTabBase {
  kind: "channel";
  channel: string;
}

export interface ViewTab extends WorkspaceTabBase {
  kind: "view";
  view: "metrics" | "schema" | "server-info";
  db?: string;
}

export type WorkspaceTab = EntityTab | QueryTab | ChannelTab | ViewTab;

/** Deterministic id so "open same entity twice" reuses the existing tab. */
export function workspaceTabId(t: Pick<WorkspaceTab, "kind"> & Partial<WorkspaceTab>): string {
  switch (t.kind) {
    case "entity":
      return `entity:${(t as EntityTab).entityKind}:${(t as EntityTab).db ?? ""}:${(t as EntityTab).name ?? ""}`;
    case "query":
      return `query:${(t as QueryTab).scriptId}`;
    case "channel":
      return `channel:${(t as ChannelTab).channel}`;
    case "view":
      return `view:${(t as ViewTab).view}:${(t as ViewTab).db ?? ""}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session types
// ─────────────────────────────────────────────────────────────────────────────

export interface SqlScript {
  id: string;
  name: string;
  sql: string;
}

export interface QueryHistoryEntry {
  sql: string;
  ts: number;
  ok: boolean;
  ms?: number;
  rows?: number;
  affected?: number | null;
}

interface SessionBase {
  connection: Connection;
  /** Open workspace tabs, ordered left→right. */
  openTabs: WorkspaceTab[];
  /** Currently focused tab id; null when no tabs open. */
  activeTabId: string | null;
  /** Ring buffer of recently closed tabs for the welcome screen. */
  recents: WorkspaceTab[];
}

export interface SqlSession extends SessionBase {
  type: "sql";
  expandedDbs: string[];
  tablesPerDb: Record<string, string[]>;
  tableFilters: Record<string, string>;
  tableSearch: string;
  /** @deprecated Active table now derives from `activeTabId` → EntityTab. */
  activeDb: string;
  /** @deprecated Use openTabs. */
  activeTable: string;
  /** @deprecated Use openTabs. */
  activeView: string;
  /** @deprecated Use openTabs (per-script content). */
  queryDraft: string;
  /** Script content store — referenced by QueryTab.scriptId. */
  queryScripts: SqlScript[];
  /** @deprecated Use openTabs. */
  activeScriptId: string;
  queryHistory: QueryHistoryEntry[];
}

export interface DocumentSession extends SessionBase {
  type: "document";
  expandedDbs: string[];
  collectionsPerDb: Record<string, string[]>;
  collectionFilters: Record<string, string>;
  collectionSearch: string;
  /** @deprecated Use openTabs. */
  activeDb: string;
  /** @deprecated Use openTabs. */
  activeCollection: string;
  /** @deprecated Use openTabs. */
  activeView: string;
}

export interface RedisSession extends SessionBase {
  type: "redis";
  keySearch: string;
  typeFilter: string;
  viewMode: "list" | "tree";
  /** @deprecated Channels now live as ChannelTab in openTabs. */
  pubsubChannels: string[];
  /** @deprecated Use openTabs. */
  pubsubActiveChannel: string | null;
  /** Persisted Redis subscriptions (survives tab close if pinned). */
  subscribedChannels: string[];
  /** @deprecated Use openTabs. */
  activeDb: string;
  /** @deprecated Use openTabs. */
  activeKey: string;
  /** @deprecated Use openTabs. */
  activeView: string;
}

export type Session = SqlSession | DocumentSession | RedisSession;

// ─────────────────────────────────────────────────────────────────────────────
// Tab helpers
// ─────────────────────────────────────────────────────────────────────────────

function findTab(session: Session, tabId: string): WorkspaceTab | undefined {
  return session.openTabs.find((t) => t.id === tabId);
}

function activeTab(session: Session): WorkspaceTab | undefined {
  return session.activeTabId ? findTab(session, session.activeTabId) : undefined;
}

export function getActiveTab(session: Session): WorkspaceTab | undefined {
  return activeTab(session);
}

function pushRecent(session: Session, tab: WorkspaceTab): WorkspaceTab[] {
  const filtered = session.recents.filter((r) => r.id !== tab.id);
  return [tab, ...filtered].slice(0, 20);
}

// ─────────────────────────────────────────────────────────────────────────────
// sessionRoute — granular params kept for now; layouts will migrate to ?tab=
// ─────────────────────────────────────────────────────────────────────────────

export function sessionRoute(session: Session): string {
  const id = session.connection.id;
  const tabParam = session.activeTabId ? `&tab=${encodeURIComponent(session.activeTabId)}` : "";
  const view = session.activeView ? `&view=${session.activeView}` : "";
  if (session.type === "document") {
    const db = session.activeDb ? `&db=${encodeURIComponent(session.activeDb)}` : "";
    const col = session.activeCollection ? `&collection=${encodeURIComponent(session.activeCollection)}` : "";
    return `/connections/document?id=${id}${db}${col}${view}${tabParam}`;
  }
  if (session.type === "redis") {
    const db = session.activeDb ? `&db=${encodeURIComponent(session.activeDb)}` : "";
    const key = session.activeKey ? `&key=${encodeURIComponent(session.activeKey)}` : "";
    return `/connections/redis?id=${id}${db}${key}${view}${tabParam}`;
  }
  const db = session.activeDb ? `&db=${encodeURIComponent(session.activeDb)}` : "";
  const table = session.activeTable ? `&table=${encodeURIComponent(session.activeTable)}` : "";
  return `/connections/sql?id=${id}${db}${table}${view}${tabParam}`;
}

function sessionTypeFor(pluginId: string): Session["type"] {
  if (pluginId === "mongodb") return "document";
  if (pluginId === "redis") return "redis";
  return "sql";
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

interface SessionsState {
  sessions: Record<number, Session>;
  loaded: boolean;
}

const sessionsStore = new Store<SessionsState>({
  sessions: {},
  loaded: false,
});

function emptyBase(): Pick<SessionBase, "openTabs" | "activeTabId" | "recents"> {
  return { openTabs: [], activeTabId: null, recents: [] };
}

function addSession(connection: Connection) {
  sessionsStore.setState((state) => {
    if (state.sessions[connection.id]) return state;
    const type = sessionTypeFor(connection.plugin_id);
    let session: Session;
    if (type === "document") {
      session = {
        type,
        connection,
        ...emptyBase(),
        expandedDbs: [],
        collectionsPerDb: {},
        collectionFilters: {},
        collectionSearch: "",
        activeDb: "",
        activeCollection: "",
        activeView: "",
      };
    } else if (type === "redis") {
      session = {
        type,
        connection,
        ...emptyBase(),
        keySearch: "",
        typeFilter: "all",
        viewMode: "tree",
        pubsubChannels: [],
        pubsubActiveChannel: null,
        subscribedChannels: [],
        activeDb: "",
        activeKey: "",
        activeView: "",
      };
    } else {
      const initialScriptId = `s-${Date.now().toString(36)}`;
      const initialSql = "-- Escribe tu consulta SQL aquí. Cmd/Ctrl+Enter para ejecutar.\n";
      session = {
        type,
        connection,
        ...emptyBase(),
        expandedDbs: [],
        tablesPerDb: {},
        tableFilters: {},
        tableSearch: "",
        activeDb: "",
        activeTable: "",
        activeView: "",
        queryDraft: initialSql,
        queryScripts: [{ id: initialScriptId, name: "Script 1", sql: initialSql }],
        activeScriptId: initialScriptId,
        queryHistory: [],
      };
    }
    return { ...state, sessions: { ...state.sessions, [connection.id]: session } };
  });
}

function removeSession(connectionId: number) {
  sessionsStore.setState((state) => {
    const next = { ...state.sessions };
    delete next[connectionId];
    return { ...state, sessions: next };
  });
}

function updateSession(connectionId: number, patch: Partial<Session>) {
  sessionsStore.setState((state) => {
    const existing = state.sessions[connectionId];
    if (!existing) return state;
    return {
      ...state,
      sessions: { ...state.sessions, [connectionId]: { ...existing, ...patch } as Session },
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab actions
// ─────────────────────────────────────────────────────────────────────────────

type NewTabInput =
  | Omit<EntityTab, "id" | "ephemeral" | "pinned" | "createdAt">
  | Omit<QueryTab, "id" | "ephemeral" | "pinned" | "createdAt">
  | Omit<ChannelTab, "id" | "ephemeral" | "pinned" | "createdAt">
  | Omit<ViewTab, "id" | "ephemeral" | "pinned" | "createdAt">;

function openTab(
  connectionId: number,
  input: NewTabInput,
  opts: { ephemeral?: boolean } = {},
) {
  sessionsStore.setState((state) => {
    const existing = state.sessions[connectionId];
    if (!existing) return state;

    const id = workspaceTabId(input as WorkspaceTab);
    const ephemeral = opts.ephemeral ?? false;

    // Already open → focus it and clear ephemeral if user re-opened it explicitly
    const found = existing.openTabs.find((t) => t.id === id);
    if (found) {
      const next: WorkspaceTab[] = existing.openTabs.map((t) =>
        t.id === id ? { ...t, ephemeral: ephemeral ? t.ephemeral : false } : t,
      );
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [connectionId]: { ...existing, openTabs: next, activeTabId: id } as Session,
        },
      };
    }

    const tab: WorkspaceTab = {
      ...(input as WorkspaceTab),
      id,
      ephemeral,
      pinned: false,
      createdAt: Date.now(),
    };

    // VSCode preview rule: if current active is ephemeral, replace it
    const activeIdx = existing.activeTabId
      ? existing.openTabs.findIndex((t) => t.id === existing.activeTabId)
      : -1;
    const activeT = activeIdx >= 0 ? existing.openTabs[activeIdx] : undefined;
    let openTabs: WorkspaceTab[];
    if (ephemeral && activeT?.ephemeral) {
      openTabs = [...existing.openTabs];
      openTabs[activeIdx] = tab;
    } else {
      openTabs = [...existing.openTabs, tab];
    }

    return {
      ...state,
      sessions: {
        ...state.sessions,
        [connectionId]: { ...existing, openTabs, activeTabId: id } as Session,
      },
    };
  });
}

function closeTab(connectionId: number, tabId: string) {
  sessionsStore.setState((state) => {
    const existing = state.sessions[connectionId];
    if (!existing) return state;
    const idx = existing.openTabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return state;
    const closed = existing.openTabs[idx];
    const openTabs = existing.openTabs.filter((_, i) => i !== idx);
    let activeTabId = existing.activeTabId;
    if (activeTabId === tabId) {
      activeTabId = openTabs[idx]?.id ?? openTabs[idx - 1]?.id ?? null;
    }
    return {
      ...state,
      sessions: {
        ...state.sessions,
        [connectionId]: {
          ...existing,
          openTabs,
          activeTabId,
          recents: pushRecent(existing, closed),
        } as Session,
      },
    };
  });
}

function pinTab(connectionId: number, tabId: string) {
  sessionsStore.setState((state) => {
    const existing = state.sessions[connectionId];
    if (!existing) return state;
    const openTabs = existing.openTabs.map((t) =>
      t.id === tabId ? { ...t, ephemeral: false, pinned: true } : t,
    );
    return {
      ...state,
      sessions: { ...state.sessions, [connectionId]: { ...existing, openTabs } as Session },
    };
  });
}

function unpinTab(connectionId: number, tabId: string) {
  sessionsStore.setState((state) => {
    const existing = state.sessions[connectionId];
    if (!existing) return state;
    const openTabs = existing.openTabs.map((t) =>
      t.id === tabId ? { ...t, pinned: false } : t,
    );
    return {
      ...state,
      sessions: { ...state.sessions, [connectionId]: { ...existing, openTabs } as Session },
    };
  });
}

function setActiveTab(connectionId: number, tabId: string | null) {
  sessionsStore.setState((state) => {
    const existing = state.sessions[connectionId];
    if (!existing) return state;
    if (tabId !== null && !existing.openTabs.find((t) => t.id === tabId)) return state;
    return {
      ...state,
      sessions: {
        ...state.sessions,
        [connectionId]: { ...existing, activeTabId: tabId } as Session,
      },
    };
  });
}

function reorderTabs(connectionId: number, orderedIds: string[]) {
  sessionsStore.setState((state) => {
    const existing = state.sessions[connectionId];
    if (!existing) return state;
    const byId = new Map(existing.openTabs.map((t) => [t.id, t]));
    const openTabs = orderedIds.map((id) => byId.get(id)).filter(Boolean) as WorkspaceTab[];
    if (openTabs.length !== existing.openTabs.length) return state;
    return {
      ...state,
      sessions: { ...state.sessions, [connectionId]: { ...existing, openTabs } as Session },
    };
  });
}

function duplicateTab(connectionId: number, tabId: string) {
  sessionsStore.setState((state) => {
    const existing = state.sessions[connectionId];
    if (!existing) return state;
    const idx = existing.openTabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return state;
    const src = existing.openTabs[idx];
    // Only QueryTab makes sense to duplicate as an independent script.
    if (src.kind !== "query") return state;
    const sqlSession = existing as SqlSession;
    const sourceScript = sqlSession.queryScripts.find((s) => s.id === src.scriptId);
    const newScriptId = `s-${Date.now().toString(36)}`;
    const newScript: SqlScript = {
      id: newScriptId,
      name: `${sourceScript?.name ?? "Script"} copy`,
      sql: sourceScript?.sql ?? "",
    };
    const newTab: QueryTab = {
      ...src,
      id: workspaceTabId({ kind: "query", scriptId: newScriptId } as QueryTab),
      scriptId: newScriptId,
      title: newScript.name,
      ephemeral: false,
      pinned: false,
      createdAt: Date.now(),
    };
    const openTabs = [...existing.openTabs];
    openTabs.splice(idx + 1, 0, newTab);
    return {
      ...state,
      sessions: {
        ...state.sessions,
        [connectionId]: {
          ...sqlSession,
          openTabs,
          activeTabId: newTab.id,
          queryScripts: [...sqlSession.queryScripts, newScript],
        } as Session,
      },
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration: backfill openTabs / activeTabId from legacy navigation fields
// ─────────────────────────────────────────────────────────────────────────────

function migrateSession(s: Session): Session {
  // Already migrated.
  if (Array.isArray(s.openTabs) && s.openTabs.length > 0) return s;

  const tabs: WorkspaceTab[] = [];
  let activeId: string | null = null;

  if (s.type === "sql") {
    for (const script of s.queryScripts ?? []) {
      const id = workspaceTabId({ kind: "query", scriptId: script.id } as QueryTab);
      tabs.push({
        id,
        kind: "query",
        scriptId: script.id,
        title: script.name,
        ephemeral: false,
        pinned: false,
        createdAt: Date.now(),
      });
    }
    if (s.activeTable) {
      const t: EntityTab = {
        id: workspaceTabId({ kind: "entity", entityKind: "table", db: s.activeDb, name: s.activeTable } as EntityTab),
        kind: "entity",
        entityKind: "table",
        db: s.activeDb,
        name: s.activeTable,
        title: s.activeTable,
        ephemeral: false,
        pinned: false,
        createdAt: Date.now(),
      };
      tabs.unshift(t);
      activeId = t.id;
    }
    if (s.activeView === "metrics") {
      const v: ViewTab = {
        id: workspaceTabId({ kind: "view", view: "metrics" } as ViewTab),
        kind: "view",
        view: "metrics",
        title: "Metrics",
        ephemeral: false,
        pinned: false,
        createdAt: Date.now(),
      };
      tabs.push(v);
      activeId = v.id;
    } else if (s.activeView === "queries" && s.activeScriptId) {
      activeId = workspaceTabId({ kind: "query", scriptId: s.activeScriptId } as QueryTab);
    }
  } else if (s.type === "document") {
    if (s.activeCollection) {
      const t: EntityTab = {
        id: workspaceTabId({ kind: "entity", entityKind: "collection", db: s.activeDb, name: s.activeCollection } as EntityTab),
        kind: "entity",
        entityKind: "collection",
        db: s.activeDb,
        name: s.activeCollection,
        title: s.activeCollection,
        ephemeral: false,
        pinned: false,
        createdAt: Date.now(),
      };
      tabs.push(t);
      activeId = t.id;
    }
    if (s.activeView === "metrics") {
      const v: ViewTab = {
        id: workspaceTabId({ kind: "view", view: "metrics" } as ViewTab),
        kind: "view",
        view: "metrics",
        title: "Metrics",
        ephemeral: false,
        pinned: false,
        createdAt: Date.now(),
      };
      tabs.push(v);
      activeId = v.id;
    }
  } else {
    // redis
    if (s.activeKey) {
      const t: EntityTab = {
        id: workspaceTabId({ kind: "entity", entityKind: "key", db: s.activeDb, name: s.activeKey } as EntityTab),
        kind: "entity",
        entityKind: "key",
        db: s.activeDb,
        name: s.activeKey,
        title: s.activeKey,
        ephemeral: false,
        pinned: false,
        createdAt: Date.now(),
      };
      tabs.push(t);
      activeId = t.id;
    }
    for (const ch of s.pubsubChannels ?? []) {
      const c: ChannelTab = {
        id: workspaceTabId({ kind: "channel", channel: ch } as ChannelTab),
        kind: "channel",
        channel: ch,
        title: ch,
        ephemeral: false,
        pinned: true,
        createdAt: Date.now(),
      };
      tabs.push(c);
    }
    if (s.activeView === "metrics") {
      const v: ViewTab = {
        id: workspaceTabId({ kind: "view", view: "metrics" } as ViewTab),
        kind: "view",
        view: "metrics",
        title: "Metrics",
        ephemeral: false,
        pinned: false,
        createdAt: Date.now(),
      };
      tabs.push(v);
      activeId = v.id;
    } else if (s.activeView === "pubsub" && s.pubsubActiveChannel) {
      activeId = workspaceTabId({ kind: "channel", channel: s.pubsubActiveChannel } as ChannelTab);
    }
  }

  return { ...s, openTabs: tabs, activeTabId: activeId ?? tabs[0]?.id ?? null } as Session;
}

function hydrate(sessions: Record<number, Session>) {
  const normalized: Record<number, Session> = {};
  for (const [id, raw] of Object.entries(sessions)) {
    let s = raw as Session;
    // Defensive: ensure base fields exist.
    if (!Array.isArray((s as Partial<SessionBase>).openTabs)) {
      s = { ...s, openTabs: [], activeTabId: null, recents: [] } as Session;
    }
    if (!Array.isArray((s as Partial<SessionBase>).recents)) {
      s = { ...s, recents: [] } as Session;
    }
    if (s.type === "sql") {
      const draft = s.queryDraft ?? "-- Escribe tu consulta SQL aquí. Cmd/Ctrl+Enter para ejecutar.\n";
      let scripts = s.queryScripts;
      let activeId = s.activeScriptId;
      if (!Array.isArray(scripts) || scripts.length === 0) {
        const sid = `s-${Date.now().toString(36)}-${id}`;
        scripts = [{ id: sid, name: "Script 1", sql: draft }];
        activeId = sid;
      } else if (!activeId || !scripts.find((sc) => sc.id === activeId)) {
        activeId = scripts[0].id;
      }
      s = {
        ...s,
        queryDraft: draft,
        queryScripts: scripts,
        activeScriptId: activeId,
        queryHistory: s.queryHistory ?? [],
      };
    }
    if (s.type === "redis") {
      // Ensure new field exists for older payloads.
      if (!Array.isArray((s as Partial<RedisSession>).subscribedChannels)) {
        s = { ...s, subscribedChannels: s.pubsubChannels ?? [] } as Session;
      }
    }
    try {
      s = migrateSession(s);
    } catch {
      // If migration fails (unexpected shape), leave openTabs empty so the
      // welcome screen renders instead of crashing.
      s = { ...s, openTabs: [], activeTabId: null } as Session;
    }
    normalized[Number(id)] = s;
  }
  sessionsStore.setState((state) => ({ ...state, sessions: normalized, loaded: true }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

type StoreFns = {
  sessions: Record<number, Session>;
  loaded: boolean;
  addSession: typeof addSession;
  removeSession: typeof removeSession;
  updateSession: typeof updateSession;
  hydrate: typeof hydrate;
  openTab: typeof openTab;
  closeTab: typeof closeTab;
  pinTab: typeof pinTab;
  unpinTab: typeof unpinTab;
  setActiveTab: typeof setActiveTab;
  reorderTabs: typeof reorderTabs;
  duplicateTab: typeof duplicateTab;
};

function buildSnapshot(state: SessionsState): StoreFns {
  return {
    sessions: state.sessions,
    loaded: state.loaded,
    addSession,
    removeSession,
    updateSession,
    hydrate,
    openTab,
    closeTab,
    pinTab,
    unpinTab,
    setActiveTab,
    reorderTabs,
    duplicateTab,
  };
}

export function useSessionsStore(): StoreFns {
  const state = useStore(sessionsStore);
  return buildSnapshot(state);
}

useSessionsStore.getState = () => buildSnapshot(sessionsStore.state);
useSessionsStore.subscribe = (cb: (state: StoreFns) => void) =>
  sessionsStore.subscribe(() => cb(buildSnapshot(sessionsStore.state)));

// Auto-save to SQLite with 1s debounce — only after initial hydration
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
sessionsStore.subscribe(() => {
  const state = sessionsStore.state;
  if (!state.loaded) return;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    invoke("save_sessions", { data: JSON.stringify(state.sessions) }).catch(() => undefined);
  }, 2500);
});
