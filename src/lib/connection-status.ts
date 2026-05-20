import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { Connection } from "@/lib/types";

export type ConnStatus = "ok" | "fail" | "unknown" | "checking";

interface CacheEntry {
  status: ConnStatus;
  ts: number;
  pending?: Promise<ConnStatus>;
}

const CACHE = new Map<number, CacheEntry>();
const TTL_MS = 60_000;

type Listener = (id: number, status: ConnStatus) => void;
const listeners = new Set<Listener>();

function publish(id: number, status: ConnStatus) {
  for (const l of listeners) l(id, status);
}

export async function ping(connection: Connection, opts?: { force?: boolean }): Promise<ConnStatus> {
  const id = connection.id;
  const now = Date.now();
  const cached = CACHE.get(id);
  if (cached?.pending) return cached.pending;
  if (cached && !opts?.force && now - cached.ts < TTL_MS && cached.status !== "checking") {
    return cached.status;
  }
  CACHE.set(id, { status: "checking", ts: now });
  publish(id, "checking");
  const pending = invoke("test_connection", { input: connection })
    .then<ConnStatus>(() => {
      CACHE.set(id, { status: "ok", ts: Date.now() });
      publish(id, "ok");
      return "ok";
    })
    .catch<ConnStatus>(() => {
      CACHE.set(id, { status: "fail", ts: Date.now() });
      publish(id, "fail");
      return "fail";
    });
  CACHE.set(id, { status: "checking", ts: now, pending });
  return pending;
}

/** Hook: returns current cached status + triggers a ping when `triggerOnMount` is true. */
export function useConnectionStatus(connection: Connection | null | undefined, triggerOnMount = false): ConnStatus {
  const id = connection?.id;
  const [status, setStatus] = useState<ConnStatus>(() =>
    id != null ? CACHE.get(id)?.status ?? "unknown" : "unknown",
  );
  useEffect(() => {
    if (id == null) return;
    const fn: Listener = (cid, s) => {
      if (cid === id) setStatus(s);
    };
    listeners.add(fn);
    setStatus(CACHE.get(id)?.status ?? "unknown");
    if (triggerOnMount && connection) {
      void ping(connection);
    }
    return () => {
      listeners.delete(fn);
    };
  }, [id, triggerOnMount, connection]);
  return status;
}

