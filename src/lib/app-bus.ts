/** Small intra-app event bus for menu-driven actions that have no obvious
 *  React-tree owner (e.g. "toggle sidebar" must reach whatever layout is
 *  currently mounted). */

type Handler = (payload?: unknown) => void;

const listeners = new Map<string, Set<Handler>>();

export function emit(event: string, payload?: unknown) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of set) fn(payload);
}

export function on(event: string, handler: Handler): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(handler);
  return () => {
    set!.delete(handler);
  };
}

export const APP_EVENT = {
  toggleSidebar: "app:toggleSidebar",
  newConnection: "app:newConnection",
  closeTab: "app:closeTab",
  jumpTab: "app:jumpTab",
} as const;
