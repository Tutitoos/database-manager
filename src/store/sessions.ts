import { create } from "zustand";
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

interface SessionsStore {
  sessions: Record<number, Session>;
  loaded: boolean;
  addSession: (connection: Connection) => void;
  removeSession: (connectionId: number) => void;
  updateSession: (connectionId: number, patch: Partial<Session>) => void;
  hydrate: (sessions: Record<number, Session>) => void;
}

export const useSessionsStore = create<SessionsStore>((set) => ({
  sessions: {},
  loaded: false,

  addSession(connection) {
    set((state) => {
      if (state.sessions[connection.id]) return state;
      const type = sessionTypeFor(connection.plugin_id);
      let session: Session;
      if (type === "document") {
        session = { type, connection, expandedDbs: [], collectionsPerDb: {}, collectionFilters: {}, collectionSearch: "", activeDb: "", activeCollection: "", activeView: "" };
      } else if (type === "redis") {
        session = { type, connection, keySearch: "", typeFilter: "all", viewMode: "tree", pubsubChannels: [], pubsubActiveChannel: null, activeDb: "", activeKey: "", activeView: "" };
      } else {
        session = { type, connection, expandedDbs: [], tablesPerDb: {}, tableFilters: {}, tableSearch: "", activeDb: "", activeTable: "", activeView: "" };
      }
      return { sessions: { ...state.sessions, [connection.id]: session } };
    });
  },

  removeSession(connectionId) {
    set((state) => {
      const next = { ...state.sessions };
      delete next[connectionId];
      return { sessions: next };
    });
  },

  updateSession(connectionId, patch) {
    set((state) => {
      const existing = state.sessions[connectionId];
      if (!existing) return state;
      return { sessions: { ...state.sessions, [connectionId]: { ...existing, ...patch } as Session } };
    });
  },

  hydrate(sessions) {
    set({ sessions, loaded: true });
  },
}));

// Auto-save to SQLite with 1s debounce — only after initial hydration
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
useSessionsStore.subscribe((state) => {
  if (!state.loaded) return;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    invoke("save_sessions", { data: JSON.stringify(state.sessions) }).catch(() => {});
  }, 1000);
});
