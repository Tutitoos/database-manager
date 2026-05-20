import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppUser } from "@/lib/types";

export const SUPPORTED_PROVIDERS = ["discord", "github", "google", "microsoft"] as const;
export type OAuthProvider = (typeof SUPPORTED_PROVIDERS)[number];

export async function currentUser(): Promise<AppUser | null> {
  return invoke("auth_current_user");
}

export async function signOut(): Promise<void> {
  await invoke("auth_sign_out");
  // Switch back to a local org so the UI doesn't keep showing remote data.
  try {
    const orgs = await invoke<{ id: number; server_kind: string }[]>("list_organizations");
    const local = orgs.find((o) => o.server_kind === "local");
    if (local) {
      await invoke("set_active_organization", { id: local.id });
      window.dispatchEvent(new CustomEvent("app:org-changed", { detail: { id: local.id } }));
    }
  } catch {
    /* ignore */
  }
}

export async function onDeepLink(cb: (url: string) => void): Promise<UnlistenFn> {
  return listen<string[]>("auth:deep-link", (event) => {
    for (const url of event.payload) cb(url);
  });
}

export function extractAuthCode(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    return url.searchParams.get("code");
  } catch {
    return null;
  }
}
