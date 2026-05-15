import { create } from "zustand";
import type { Connection } from "@/lib/types";

export interface SqlSession {
  type: "sql";
  connection: Connection;
  expandedDbs: string[];
  tablesPerDb: Record<string, string[]>;
  appliedFilter: string;
}

export interface DocumentSession {
  type: "document";
  connection: Connection;
  expandedDbs: string[];
  collectionsPerDb: Record<string, string[]>;
  appliedFilter: string;
}

export interface RedisSession {
  type: "redis";
  connection: Connection;
  keySearch: string;
  typeFilter: string;
  viewMode: "list" | "tree";
}

export type Session = SqlSession | DocumentSession | RedisSession;

function sessionTypeFor(pluginId: string): Session["type"] {
  if (pluginId === "mongodb") return "document";
  if (pluginId === "redis") return "redis";
  return "sql";
}

interface SessionsStore {
  sessions: Record<number, Session>;
  addSession: (connection: Connection) => void;
  removeSession: (connectionId: number) => void;
  updateSession: (connectionId: number, patch: Partial<Session>) => void;
}

export const useSessionsStore = create<SessionsStore>((set) => ({
  sessions: {},

  addSession(connection) {
    set((state) => {
      if (state.sessions[connection.id]) return state;
      const type = sessionTypeFor(connection.plugin_id);
      let session: Session;
      if (type === "document") {
        session = { type, connection, expandedDbs: [], collectionsPerDb: {}, appliedFilter: "" };
      } else if (type === "redis") {
        session = { type, connection, keySearch: "", typeFilter: "all", viewMode: "tree" };
      } else {
        session = { type, connection, expandedDbs: [], tablesPerDb: {}, appliedFilter: "" };
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
}));
