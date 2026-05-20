import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, writeFile } from "@tauri-apps/plugin-fs";

export interface SaveFileOptions {
  defaultPath: string;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
}

export interface SaveFileResult {
  saved: boolean;
  path: string | null;
}

async function saveText(content: string, opts: SaveFileOptions): Promise<SaveFileResult> {
  const path = await save({
    defaultPath: opts.defaultPath,
    filters: opts.filters,
    title: opts.title,
  });
  if (!path) return { saved: false, path: null };
  await writeTextFile(path, content);
  return { saved: true, path };
}

async function saveBytes(bytes: Uint8Array, opts: SaveFileOptions): Promise<SaveFileResult> {
  const path = await save({
    defaultPath: opts.defaultPath,
    filters: opts.filters,
    title: opts.title,
  });
  if (!path) return { saved: false, path: null };
  await writeFile(path, bytes);
  return { saved: true, path };
}

export async function saveJson(value: unknown, opts: Omit<SaveFileOptions, "filters">): Promise<SaveFileResult> {
  return saveText(JSON.stringify(value, null, 2), {
    ...opts,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
}

export async function saveCsv(content: string, opts: Omit<SaveFileOptions, "filters">): Promise<SaveFileResult> {
  return saveText(content, {
    ...opts,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
}

export async function saveTextFile(content: string, opts: SaveFileOptions): Promise<SaveFileResult> {
  return saveText(content, opts);
}

export async function saveBinaryFile(bytes: Uint8Array, opts: SaveFileOptions): Promise<SaveFileResult> {
  return saveBytes(bytes, opts);
}
