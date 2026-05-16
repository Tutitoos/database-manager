import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type SyncStatus = {
  status: "idle" | "pushed" | "pulled" | "done" | "error";
  pushed: number;
  pulled: number;
  error: string | null;
};

export async function syncNow(): Promise<SyncStatus> {
  return invoke("sync_run");
}

export async function syncPush(): Promise<SyncStatus> {
  return invoke("sync_push");
}

export async function syncPull(since?: string | null): Promise<SyncStatus> {
  return invoke("sync_pull", { since: since ?? null });
}

export async function onSyncStatus(cb: (status: SyncStatus) => void): Promise<UnlistenFn> {
  return listen<SyncStatus>("sync:status", (event) => cb(event.payload));
}

let _syncTimer: ReturnType<typeof setTimeout> | null = null;

export function triggerSync(delayMs = 800): void {
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    _syncTimer = null;
    syncNow().catch(() => undefined);
  }, delayMs);
}
