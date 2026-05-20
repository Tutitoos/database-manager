import { Store } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";
import { invoke } from "@tauri-apps/api/core";

export interface OrgRecord {
  id: number;
  name: string;
  server_url: string | null;
  server_kind: "local" | "discovered" | "manual";
  cert_fingerprint: string | null;
  accent_color: string | null;
  icon_url: string | null;
  version: string | null;
  last_health_ok: boolean;
  user_email: string | null;
  user_id: string | null;
  role: "owner" | "admin" | "member" | "viewer" | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface OrgHealth {
  name: string;
  version?: string | null;
  accent_color?: string | null;
  icon_url?: string | null;
  providers?: string[];
  min_client_version?: string | null;
  cert_fingerprint?: string | null;
}

interface OrgsState {
  orgs: OrgRecord[];
  activeId: number | null;
  loaded: boolean;
}

const store = new Store<OrgsState>({ orgs: [], activeId: null, loaded: false });

export async function refreshOrgs(): Promise<void> {
  const [list, active] = await Promise.all([
    invoke<OrgRecord[]>("list_organizations").catch(() => [] as OrgRecord[]),
    invoke<OrgRecord | null>("get_active_organization").catch(() => null),
  ]);
  store.setState(() => ({
    orgs: list,
    activeId: active?.id ?? (list[0]?.id ?? null),
    loaded: true,
  }));
}

export async function setActiveOrg(id: number): Promise<void> {
  await invoke("set_active_organization", { id });
  // Update the React store *before* firing side effects so any consumer
  // (Sidebar, OrgSwitcher, route layouts) reads the new active id even if a
  // downstream call rejects.
  store.setState((s) => ({ ...s, activeId: id }));
  window.dispatchEvent(new CustomEvent("app:org-changed", { detail: { id } }));
}

export async function addOrg(input: {
  name: string;
  server_url?: string | null;
  server_kind: "local" | "discovered" | "manual";
  accent_color?: string | null;
  icon_url?: string | null;
  cert_fingerprint?: string | null;
  version?: string | null;
  user_email?: string | null;
  user_id?: string | null;
  role?: string | null;
}): Promise<OrgRecord> {
  const created = await invoke<OrgRecord>("add_organization", {
    input: {
      server_url: null,
      accent_color: null,
      icon_url: null,
      cert_fingerprint: null,
      version: null,
      user_email: null,
      user_id: null,
      role: null,
      ...input,
    },
  });
  await refreshOrgs();
  return created;
}

export async function updateOrg(id: number, patch: {
  name?: string;
  accent_color?: string | null;
  icon_url?: string | null;
  cert_fingerprint?: string | null;
  version?: string | null;
}): Promise<void> {
  // Tauri 2 maps JS camelCase invoke keys → Rust snake_case command params.
  // Passing `accent_color` directly would silently drop the value. Translate
  // here so callers can keep using the snake_case field shape.
  await invoke("update_organization", {
    id,
    name: patch.name,
    accentColor: patch.accent_color,
    iconUrl: patch.icon_url,
    certFingerprint: patch.cert_fingerprint,
    version: patch.version,
  });
  await refreshOrgs();
}

export async function deleteOrg(id: number): Promise<void> {
  await invoke("delete_organization", { id });
  await refreshOrgs();
}

export async function fetchOrgHealth(url: string, pinned?: string | null): Promise<OrgHealth> {
  return invoke<OrgHealth>("org_health", { url, pinned: pinned ?? null });
}

export function useOrgs(): OrgsState {
  return useStore(store);
}
