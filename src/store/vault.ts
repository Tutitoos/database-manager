import { Store } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";
import { invoke } from "@tauri-apps/api/core";
import type { PassphraseStatus } from "@/lib/auth";

export interface VaultState {
  status: PassphraseStatus;
  loaded: boolean;
}

const vaultStore = new Store<VaultState>({
  status: { configured: false, unlocked: false },
  loaded: false,
});

export async function refreshVault(): Promise<PassphraseStatus> {
  const status = await invoke<PassphraseStatus>("auth_passphrase_status");
  vaultStore.setState(() => ({ status, loaded: true }));
  return status;
}

export async function unlockVault(passphrase: string): Promise<void> {
  await invoke("auth_unlock", { passphrase });
  await refreshVault();
}

export async function lockVault(): Promise<void> {
  await invoke("auth_lock");
  await refreshVault();
}

export async function setVaultPassphrase(passphrase: string): Promise<void> {
  await invoke("auth_set_passphrase", { passphrase });
  await refreshVault();
}

export async function changeVaultPassphrase(
  oldPassphrase: string,
  newPassphrase: string,
): Promise<void> {
  await invoke("auth_change_passphrase", { oldPassphrase, newPassphrase });
  await refreshVault();
}

export function useVault(): VaultState {
  return useStore(vaultStore);
}

export function getVaultState(): VaultState {
  return vaultStore.state;
}
