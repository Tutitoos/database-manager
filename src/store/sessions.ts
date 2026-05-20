import { Store } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";
import { invoke } from "@tauri-apps/api/core";
import type { Connection } from "@/lib/types";

export interface SqlSession {
  type: "sql";
  connection: Connection;
  expandedDbs: string[];
  tablesPerDb: Record<string, string[]>;
  tableFilters: Record<string, string>;
  tableSearch: string;
  activeDb: string;
  activeTable: string;
  activeView: string;
  queryDraft: string;
  queryHistory: QueryHistoryEntry[];
}

export interface QueryHistoryEntry {
  sql: string;
  ts: number;
  ok: boolean;
  ms?: number;
  rows?: number;
  affected?: number | null;
}

export interface DocumentSession {
  type: "document";
  connection: Connection;
  expandedDbs: string[];
  collectionsPerDb: Record<string, string[]>;
  collectionFilters: Record<string, string>;
  collectionSearch: string;
  activeDb: string;
  activeCollection: string;
  activeView: string;
}

export interface RedisSession {
  type: "redis";
  connection: Connection;
  keySearch: string;
  typeFilter: string;
  viewMode: "list" | "tree";
  pubsubChannels: string[];
  pubsubActiveChannel: string | null;
  activeDb: string;
  activeKey: string;
  activeView: string;
}

export type Session = SqlSession | DocumentSession | RedisSession;

export function sessionRoute(session: Session): string {
  const id = session.connection.id;
  const view = session.activeView ? `&view=${session.activeView}` : "";
  if (session.type === "document") {
    const db = session.activeDb ? `&db=${encodeURIComponent(session.activeDb)}` : "";
    const col = session.activeCollection ? `&collection=${encodeURIComponent(session.activeCollection)}` : "";
    return `/connections/document?id=${id}${db}${col}${view}`;
  }
  if (session.type === "redis") {
    const db = session.activeDb ? `&db=${encodeURIComponent(session.activeDb)}` : "";
    const key = session.activeKey ? `&key=${encodeURIComponent(session.activeKey)}` : "";
    return `/connections/redis?id=${id}${db}${key}${view}`;
  }
  const db = session.activeDb ? `&db=${encodeURIComponent(session.activeDb)}` : "";
  const table = session.activeTable ? `&table=${encodeURIComponent(session.activeTable)}` : "";
  return `/connections/sql?id=${id}${db}${table}${view}`;
}

function sessionTypeFor(pluginId: string): Session["type"] {
  if (pluginId === "mongodb") return "document";
  if (pluginId === "redis") return "redis";
  return "sql";
}

interface SessionsState {
  sessions: Record<number, Session>;
  loaded: boolean;
}

const sessionsStore = new Store<SessionsState>({
  sessions: {},
  loaded: false,
});

function addSession(connection: Connection) {
  sessionsStore.setState((state) => {
    if (state.sessions[connection.id]) return state;
    const type = sessionTypeFor(connection.plugin_id);
    let session: Session;
    if (type === "document") {
      session = {
        type,
        connection,
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
        keySearch: "",
        typeFilter: "all",
        viewMode: "tree",
        pubsubChannels: [],
        pubsubActiveChannel: null,
        activeDb: "",
        activeKey: "",
        activeView: "",
      };
    } else {
      session = {
        type,
        connection,
        expandedDbs: [],
        tablesPerDb: {},
        tableFilters: {},
        tableSearch: "",
        activeDb: "",
        activeTable: "",
        activeView: "",
        queryDraft: "-- Escribe tu consulta SQL aquí. Cmd/Ctrl+Enter para ejecutar.\n",
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

function hydrate(sessions: Record<number, Session>) {
  // Backfill fields added after a session was originally stored so older
  // payloads from SQLite don't blow up when the UI reads them.
  const normalized: Record<number, Session> = {};
  for (const [id, raw] of Object.entries(sessions)) {
    let s = raw as Session;
    if (s.type === "sql") {
      s = {
        ...s,
        queryDraft: s.queryDraft ?? "-- Escribe tu consulta SQL aquí. Cmd/Ctrl+Enter para ejecutar.\n",
        queryHistory: s.queryHistory ?? [],
      };
    }
    normalized[Number(id)] = s;
  }
  sessionsStore.setState((state) => ({ ...state, sessions: normalized, loaded: true }));
}

type StoreFns = {
  sessions: Record<number, Session>;
  loaded: boolean;
  addSession: typeof addSession;
  removeSession: typeof removeSession;
  updateSession: typeof updateSession;
  hydrate: typeof hydrate;
};

function buildSnapshot(state: SessionsState): StoreFns {
  return {
    sessions: state.sessions,
    loaded: state.loaded,
    addSession,
    removeSession,
    updateSession,
    hydrate,
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
  }, 1000);
});
