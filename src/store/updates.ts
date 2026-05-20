import { Store } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";
import type { LatestRelease } from "@/lib/updates";

interface UpdatesState {
  /** Latest release found by a background check, or null if none / not checked yet. */
  available: LatestRelease | null;
  /** True after the user has dismissed the boot toast for `available.version`. The
   *  StatusBar indicator stays visible so they can come back to it. */
  toastDismissed: boolean;
}

const store = new Store<UpdatesState>({
  available: null,
  toastDismissed: false,
});

/** Module-level guard that survives React StrictMode + Hot Reload. Without it
 *  the boot useEffect would push the same toast multiple times on the first
 *  paint. */
let bootCheckRan = false;

export function markBootCheckRan(): boolean {
  if (bootCheckRan) return false;
  bootCheckRan = true;
  return true;
}

export function setAvailableUpdate(release: LatestRelease | null) {
  store.setState((s) => ({
    available: release,
    // If the new available version differs from a previously-dismissed one,
    // reset the dismissed flag so the user sees the new toast.
    toastDismissed: release && s.available?.version === release.version ? s.toastDismissed : false,
  }));
}

export function dismissUpdateToast() {
  store.setState((s) => ({ ...s, toastDismissed: true }));
}

export function clearAvailableUpdate() {
  store.setState(() => ({ available: null, toastDismissed: false }));
}

export function useUpdatesStore(): UpdatesState {
  return useStore(store);
}

export function getUpdatesState(): UpdatesState {
  return store.state;
}
