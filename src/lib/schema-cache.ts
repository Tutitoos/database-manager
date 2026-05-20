import { invoke } from "@tauri-apps/api/core";
import type { Connection } from "@/lib/types";

export type SchemaMap = Record<string, string[]>;

interface Entry {
  ts: number;
  schema: SchemaMap;
  pending?: Promise<SchemaMap>;
}

const TTL_MS = 5 * 60 * 1000;
const CACHE = new Map<string, Entry>();

function key(connId: number, database: string): string {
  return `${connId}::${database}`;
}

/** Build a `{ tableName: ["col1","col2"] }` map suitable for codemirror lang-sql. */
export async function getSchema(connection: Connection, database: string): Promise<SchemaMap> {
  const k = key(connection.id, database);
  const now = Date.now();
  const cached = CACHE.get(k);
  if (cached && now - cached.ts < TTL_MS && !cached.pending) return cached.schema;
  if (cached?.pending) return cached.pending;

  const pending = loadSchema(connection, database)
    .then((schema) => {
      CACHE.set(k, { ts: Date.now(), schema });
      return schema;
    })
    .catch(() => {
      CACHE.set(k, { ts: Date.now(), schema: {} });
      return {} as SchemaMap;
    });

  CACHE.set(k, { ts: now, schema: cached?.schema ?? {}, pending });
  return pending;
}

async function loadSchema(connection: Connection, database: string): Promise<SchemaMap> {
  const tables = await invoke<string[]>("list_collections", { input: connection, database });
  // Pull columns per table by sampling get_table_data with limit=0. Cheaper than
  // a real PRAGMA/info_schema call from frontend; the plugin returns columns.
  const out: SchemaMap = {};
  // Cap how many we fetch concurrently — large DBs with hundreds of tables can be heavy.
  const cap = Math.min(tables.length, 50);
  await Promise.all(
    tables.slice(0, cap).map(async (table) => {
      try {
        const res = await invoke<{ columns?: string[] }>("get_table_data", {
          input: connection,
          database,
          table,
          limit: 1,
          offset: 0,
          filter: "",
          cursor: "",
        });
        out[table] = res.columns ?? [];
      } catch {
        out[table] = [];
      }
    }),
  );
  return out;
}

