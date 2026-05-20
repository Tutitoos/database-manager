import { getVersion } from "@tauri-apps/api/app";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const REPO = "Tutitoos/database-manager";

/** Native Tauri updater check (uses tauri.conf.json `plugins.updater.endpoints`).
 *  Returns the Update handle if a newer version exists. */
export async function checkNativeUpdate(): Promise<Update | null> {
  try {
    const u = await check();
    return u && u.available ? u : null;
  } catch {
    return null;
  }
}

/** Download + install + relaunch. Throws on failure. */
export async function installAndRelaunch(update: Update, onProgress?: (loaded: number, total?: number) => void): Promise<void> {
  let total: number | undefined;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") total = event.data.contentLength;
    if (event.event === "Progress") onProgress?.(event.data.chunkLength, total);
  });
  await relaunch();
}

export async function currentVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "0.0.0";
  }
}

export interface LatestRelease {
  version: string;
  url: string;
  notes: string;
}

export async function checkLatest(): Promise<LatestRelease | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
  if (!res.ok) return null;
  const data = (await res.json()) as { tag_name?: string; html_url?: string; body?: string };
  const tag = (data.tag_name ?? "").replace(/^v/, "");
  if (!tag) return null;
  return { version: tag, url: data.html_url ?? `https://github.com/${REPO}/releases`, notes: data.body ?? "" };
}

/** Returns the latest release iff it's newer than the installed app. */
export async function findUpdate(): Promise<LatestRelease | null> {
  const [installed, latest] = await Promise.all([currentVersion(), checkLatest()]);
  if (!latest) return null;
  return compareSemver(latest.version, installed) > 0 ? latest : null;
}

export async function openReleasePage(url: string): Promise<void> {
  try {
    await openExternal(url);
  } catch {
    window.open(url, "_blank");
  }
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((p) => parseInt(p, 10) || 0);
  const pb = b.split(".").map((p) => parseInt(p, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
