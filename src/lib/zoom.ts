import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";

const SETTING_KEY = "app.zoom";
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.5;
export const ZOOM_STEP = 0.1;
const MIN = ZOOM_MIN;
const MAX = ZOOM_MAX;
const STEP = ZOOM_STEP;
const DEFAULT = 1.0;

let current = DEFAULT;

function clamp(z: number): number {
  return Math.min(MAX, Math.max(MIN, Math.round(z * 100) / 100));
}

async function applyZoom(z: number): Promise<void> {
  current = clamp(z);
  try {
    await getCurrentWebview().setZoom(current);
  } catch {
    document.documentElement.style.zoom = String(current);
  }
}

export async function loadZoom(): Promise<number> {
  try {
    const raw = await invoke<string | null>("get_app_setting", { key: SETTING_KEY });
    const parsed = raw ? JSON.parse(raw) : null;
    const value = typeof parsed === "number" ? parsed : DEFAULT;
    await applyZoom(value);
    return current;
  } catch {
    await applyZoom(DEFAULT);
    return DEFAULT;
  }
}

async function persist(): Promise<void> {
  try {
    await invoke("set_app_setting", { key: SETTING_KEY, valueJson: JSON.stringify(current) });
  } catch { /* ignore */ }
}

export async function zoomIn(): Promise<void> {
  await applyZoom(current + STEP);
  await persist();
}

export async function zoomOut(): Promise<void> {
  await applyZoom(current - STEP);
  await persist();
}

export async function zoomReset(): Promise<void> {
  await applyZoom(DEFAULT);
  await persist();
}

export function getZoom(): number {
  return current;
}

export async function setZoom(z: number): Promise<void> {
  await applyZoom(z);
  await persist();
}
