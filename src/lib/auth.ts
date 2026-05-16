import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  changeVaultPassphrase,
  lockVault,
  refreshVault,
  setVaultPassphrase,
  unlockVault,
} from "@/store/vault";
import type { AppUser } from "@/lib/types";

export type PassphraseStatus = { configured: boolean; unlocked: boolean };

export const SUPPORTED_PROVIDERS = ["discord", "github", "google", "microsoft"] as const;
export type OAuthProvider = (typeof SUPPORTED_PROVIDERS)[number];

export async function passphraseStatus(): Promise<PassphraseStatus> {
  return refreshVault();
}

export async function setPassphrase(passphrase: string): Promise<void> {
  await setVaultPassphrase(passphrase);
}

export async function unlock(passphrase: string): Promise<void> {
  await unlockVault(passphrase);
}

export async function lock(): Promise<void> {
  await lockVault();
}

export async function changePassphrase(
  oldPassphrase: string,
  newPassphrase: string,
): Promise<void> {
  await changeVaultPassphrase(oldPassphrase, newPassphrase);
}

export async function currentUser(): Promise<AppUser | null> {
  return invoke("auth_current_user");
}

export async function signOut(): Promise<void> {
  await invoke("auth_sign_out");
}

export const DEFAULT_SYNC_SERVER_URL = "";
export const EXAMPLE_SYNC_SERVER_URL = "https://sync.example.com";

export async function getSyncServerUrl(): Promise<string | null> {
  const raw = await invoke<string | null>("get_app_setting", { key: "sync.server_url" });
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string" && parsed.trim() !== "") return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

export async function setSyncServerUrl(url: string): Promise<void> {
  await invoke("set_app_setting", {
    key: "sync.server_url",
    valueJson: JSON.stringify(url),
  });
}

export async function startOAuth(provider: OAuthProvider): Promise<void> {
  const serverUrl = await getSyncServerUrl();
  if (!serverUrl) throw new Error("Configura la URL del servidor de sincronización primero.");
  const targetUrl = await invoke<string>("auth_start_oauth", {
    provider,
    serverUrl,
  });
  await openExternal(targetUrl);
}

export async function completeOAuth(code: string): Promise<AppUser> {
  const serverUrl = await getSyncServerUrl();
  if (!serverUrl) throw new Error("Server URL not configured.");
  return invoke("auth_complete_oauth", { serverUrl, code });
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
