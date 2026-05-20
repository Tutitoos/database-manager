import { Store } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";
import { invoke } from "@tauri-apps/api/core";

export interface AppSettings {
  // Conexiones (mostrado en Mi cuenta)
  confirmDelete: boolean;
  autoConnect: boolean;
  showSidebarBadges: boolean;
  restoreLastSession: boolean;
  notifyUpdates: boolean;
  // Shortcuts: action_id -> array of key tokens (override). Empty / missing = default.
  shortcutOverrides: Record<string, string[]>;
}

const DEFAULT_SETTINGS: AppSettings = {
  confirmDelete: true,
  autoConnect: true,
  showSidebarBadges: true,
  restoreLastSession: true,
  notifyUpdates: true,
  shortcutOverrides: {},
};

const SETTING_KEY = "app.preferences";

const store = new Store<{ values: AppSettings; loaded: boolean }>({
  values: DEFAULT_SETTINGS,
  loaded: false,
});

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await invoke<string | null>("get_app_setting", { key: SETTING_KEY });
    const parsed: Partial<AppSettings> = raw ? (JSON.parse(raw) as Partial<AppSettings>) : {};
    const merged: AppSettings = { ...DEFAULT_SETTINGS, ...parsed };
    store.setState(() => ({ values: merged, loaded: true }));
    return merged;
  } catch {
    store.setState(() => ({ values: DEFAULT_SETTINGS, loaded: true }));
    return DEFAULT_SETTINGS;
  }
}

export async function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
  const next = { ...store.state.values, [key]: value };
  store.setState(() => ({ values: next, loaded: true }));
  await invoke("set_app_setting", { key: SETTING_KEY, valueJson: JSON.stringify(next) }).catch(() => undefined);
}

export async function resetSettings(): Promise<void> {
  store.setState(() => ({ values: DEFAULT_SETTINGS, loaded: true }));
  await invoke("set_app_setting", { key: SETTING_KEY, valueJson: JSON.stringify(DEFAULT_SETTINGS) }).catch(() => undefined);
}

export function useSettings(): AppSettings {
  return useStore(store, (s) => s.values);
}

export function getSettings(): AppSettings {
  return store.state.values;
}

export async function exportSettingsJson(): Promise<string> {
  return JSON.stringify(store.state.values, null, 2);
}

export async function importSettingsJson(text: string): Promise<AppSettings> {
  const parsed = JSON.parse(text) as Partial<AppSettings>;
  const merged: AppSettings = { ...DEFAULT_SETTINGS, ...parsed };
  store.setState(() => ({ values: merged, loaded: true }));
  await invoke("set_app_setting", { key: SETTING_KEY, valueJson: JSON.stringify(merged) }).catch(() => undefined);
  return merged;
}
