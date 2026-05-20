import { XMLParser } from "fast-xml-parser";
import * as z from "zod";

export type ImportSource = "native" | "dbeaver" | "datagrip" | "dataflare" | "tableplus" | "unknown";

export interface ImportConnection {
  name: string;
  plugin_id: string;
  host: string;
  port?: number | null;
  database: string;
  username: string;
  password: string;
  ssl_mode?: string | null;
  settings_json?: string;
  group_name?: string | null;
  credential_id?: number | null;
}

export interface ImportGroup {
  name: string;
  parent_name?: string | null;
}

export interface ImportBundle {
  source: ImportSource;
  connections: ImportConnection[];
  groups: ImportGroup[];
  warnings: string[];
}

export interface ImportError {
  source: ImportSource;
  message: string;
}

const NativeConnectionSchema = z.object({
  name: z.string(),
  plugin_id: z.string(),
  host: z.string().default(""),
  port: z.number().int().nullable().optional(),
  database: z.string().default(""),
  username: z.string().default(""),
  password: z.string().default(""),
  ssl_mode: z.string().nullable().optional(),
  settings_json: z.string().default("{}"),
  group_id: z.number().int().nullable().optional(),
  credential_id: z.number().int().nullable().optional(),
});

const NativeGroupSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  parent_id: z.number().int().nullable().optional(),
});

const NativeBundleSchema = z.object({
  schema: z.string().optional(),
  schema_version: z.number().int().optional(),
  connections: z.array(NativeConnectionSchema).default([]),
  groups: z.array(NativeGroupSchema).default([]),
});

/**
 * Sniff the format from the raw text + parsed JS value. Returns "unknown" when
 * nothing matches so callers can prompt the user instead of guessing.
 */
export function detectFormat(text: string, parsed: unknown): ImportSource {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<")) {
    if (/<DataSource\b/i.test(trimmed) || /<component\s+name="DataSourceManagerImpl"/i.test(trimmed)) {
      return "datagrip";
    }
    return "unknown";
  }
  if (!parsed || typeof parsed !== "object") return "unknown";
  const obj = parsed as Record<string, unknown>;
  const schema = typeof obj.schema === "string" ? obj.schema : null;
  if (schema?.startsWith("database-manager.")) return "native";
  if ("dataSourceManagerVersion" in obj || ("connections" in obj && "drivers" in obj)) return "dbeaver";
  // DataFlare is a thin newer client; community exports use top-level
  // `dataflareVersion` or wrap a `connections` array next to a `meta` blob.
  if ("dataflareVersion" in obj || "dataflare" in obj) return "dataflare";
  if (typeof obj.schema_version === "number" && Array.isArray(obj.connections)) return "native";
  if (Array.isArray(obj.connections)) return "native";
  return "unknown";
}

/** Native bundle (our own exports). Already in the target shape — only the
 *  groups need flattening into name-keyed references. */
export function parseNative(parsed: unknown): ImportBundle {
  const data = NativeBundleSchema.parse(parsed);
  const groupById = new Map<number, { name: string; parent_id?: number | null }>();
  for (const g of data.groups) {
    groupById.set(g.id, { name: g.name, parent_id: g.parent_id ?? null });
  }
  const groups: ImportGroup[] = data.groups.map((g) => ({
    name: g.name,
    parent_name: g.parent_id != null ? groupById.get(g.parent_id)?.name ?? null : null,
  }));
  const connections: ImportConnection[] = data.connections.map((c) => ({
    name: c.name,
    plugin_id: c.plugin_id,
    host: c.host,
    port: c.port ?? null,
    database: c.database,
    username: c.username,
    password: c.password,
    ssl_mode: c.ssl_mode ?? null,
    settings_json: c.settings_json,
    group_name: c.group_id != null ? groupById.get(c.group_id)?.name ?? null : null,
    credential_id: c.credential_id ?? null,
  }));
  return { source: "native", connections, groups, warnings: [] };
}

const DBEAVER_DRIVER_MAP: Record<string, string> = {
  postgres: "postgresql",
  postgresql: "postgresql",
  postgre_jdbc: "postgresql",
  mysql: "mysql",
  mariadb: "mysql",
  mongodb: "mongodb",
  mongo: "mongodb",
  redis: "redis",
  sqlite: "sqlite",
  sqlserver: "sqlserver",
  mssql: "sqlserver",
  oracle: "oracle",
};

/** DBeaver workspace JSON (Window > Export > Project). Shape:
 *  `{ connections: { "id1": { name, driver, configuration: { url, host, port, database, properties: { user, password }, ... } } }, drivers: {...} }`. */
export function parseDBeaver(parsed: unknown): ImportBundle {
  const warnings: string[] = [];
  if (!parsed || typeof parsed !== "object") {
    throw new Error("DBeaver export must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  const connsRaw = obj.connections;
  if (!connsRaw || typeof connsRaw !== "object") {
    return { source: "dbeaver", connections: [], groups: [], warnings: ["no connections found"] };
  }
  const connections: ImportConnection[] = [];
  for (const [id, raw] of Object.entries(connsRaw)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = (r.name as string) ?? id;
    const driver = String(r.driver ?? r.provider ?? "").toLowerCase();
    const pluginId = DBEAVER_DRIVER_MAP[driver];
    if (!pluginId) {
      warnings.push(`skipped "${name}": unsupported driver "${driver}"`);
      continue;
    }
    const config = (r.configuration as Record<string, unknown> | undefined) ?? {};
    const props = (config.properties as Record<string, unknown> | undefined) ?? {};
    const portRaw = config.port ?? r.port;
    const port = portRaw == null || portRaw === "" ? null : Number(portRaw);
    connections.push({
      name,
      plugin_id: pluginId,
      host: String(config.host ?? r.host ?? "localhost"),
      port: Number.isFinite(port) ? (port as number) : null,
      database: String(config.database ?? r.database ?? ""),
      username: String(props.user ?? config.user ?? ""),
      password: String(props.password ?? config.password ?? ""),
      ssl_mode: null,
      settings_json: "{}",
      group_name: typeof r.folder === "string" ? (r.folder as string) : null,
      credential_id: null,
    });
  }
  // Folders may be expressed either flat ("folder": "Prod/EU") or in a
  // separate `folders` array. Collect uniques to recreate them client-side.
  const groupNames = new Set<string>();
  for (const c of connections) {
    if (c.group_name) groupNames.add(c.group_name);
  }
  const groups: ImportGroup[] = Array.from(groupNames).map((name) => ({ name, parent_name: null }));
  return { source: "dbeaver", connections, groups, warnings };
}

/** JetBrains DataGrip stores connections in `.idea/dataSources.xml`. The XML
 *  contains a `<component name="DataSourceManagerImpl">` with one `<data-source>`
 *  per connection; the driver lives in `@dialect` and the JDBC URL in
 *  `<jdbc-url>`. Passwords are not exported (stored in OS keychain). */
export function parseDataGrip(text: string): ImportBundle {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: true,
    isArray: (name) => name === "data-source",
  });
  const xml = parser.parse(text);
  const warnings: string[] = [];
  const project = xml?.project ?? xml;
  const components = project?.component ? toArray(project.component) : [];
  const ds = components.find((c) => c?.["@_name"] === "DataSourceManagerImpl");
  const sources = ds?.["data-source"] ? toArray(ds["data-source"]) : [];
  const connections: ImportConnection[] = [];
  const folderNames = new Set<string>();
  for (const s of sources) {
    const name = String(s["@_name"] ?? s["@_id"] ?? "Unnamed");
    const dialect = String(s["@_dialect"] ?? "").toLowerCase();
    const pluginId = DATAGRIP_DIALECT_MAP[dialect] ?? DBEAVER_DRIVER_MAP[dialect];
    if (!pluginId) {
      warnings.push(`skipped "${name}": unsupported dialect "${dialect}"`);
      continue;
    }
    const jdbcUrl = String(s["jdbc-url"] ?? "");
    const parts = parseJdbcUrl(jdbcUrl);
    const folder = typeof s["@_group"] === "string" ? (s["@_group"] as string) : null;
    if (folder) folderNames.add(folder);
    connections.push({
      name,
      plugin_id: pluginId,
      host: parts.host ?? "localhost",
      port: parts.port,
      database: parts.database ?? "",
      username: String(s["user-name"] ?? ""),
      password: "",
      ssl_mode: null,
      settings_json: "{}",
      group_name: folder,
      credential_id: null,
    });
  }
  if (sources.length > 0) {
    warnings.push("DataGrip does not export passwords — re-enter them after import");
  }
  const groups: ImportGroup[] = Array.from(folderNames).map((name) => ({ name, parent_name: null }));
  return { source: "datagrip", connections, groups, warnings };
}

const DATAGRIP_DIALECT_MAP: Record<string, string> = {
  postgres: "postgresql",
  postgresql: "postgresql",
  mysql: "mysql",
  mariadb: "mysql",
  mongo: "mongodb",
  mongodb: "mongodb",
  redis: "redis",
  sqlite: "sqlite",
  mssql: "sqlserver",
  oracle: "oracle",
};

/** Best-effort JDBC URL parser. Handles the most common shapes:
 *  - jdbc:postgresql://host:port/dbname
 *  - jdbc:mysql://host:port/dbname?params
 *  - jdbc:sqlserver://host:port;databaseName=dbname
 *  - mongodb://host:port/dbname */
function parseJdbcUrl(url: string): { host: string | null; port: number | null; database: string | null } {
  const out = { host: null as string | null, port: null as number | null, database: null as string | null };
  if (!url) return out;
  const stripped = url.replace(/^jdbc:/, "");
  const schemeMatch = stripped.match(/^[a-z]+:\/\/(.+)$/i);
  if (!schemeMatch) return out;
  const rest = schemeMatch[1];
  // SQL Server packs db + props into ";"-separated key=value pairs without a
  // path segment, while postgres/mysql use a /dbname?params shape. Search for
  // both terminators to find where the host:port chunk ends.
  const terminator = rest.search(/[/;?]/);
  const hostPart = terminator >= 0 ? rest.slice(0, terminator) : rest;
  const tailPart = terminator >= 0 ? rest.slice(terminator) : "";
  const [host, portStr] = hostPart.split(":");
  out.host = host || null;
  if (portStr) {
    const n = Number(portStr);
    if (Number.isFinite(n)) out.port = n;
  }
  if (tailPart) {
    // Strip the leading delimiter so split() doesn't yield an empty first chunk.
    const tail = tailPart.replace(/^[/;?]/, "");
    if (tailPart.startsWith("/")) {
      const dbPart = tail.split(/[?;]/)[0];
      if (dbPart) out.database = dbPart;
    }
    const dbNameMatch = tail.match(/(?:^|[;?&])databaseName=([^;?&]+)/i);
    if (dbNameMatch) out.database = dbNameMatch[1];
  }
  return out;
}

/** DataFlare exports look like a thin newer client: top-level `connections`
 *  array with a `provider` discriminator plus connection fields. We map
 *  liberally and warn on unknown providers. */
export function parseDataFlare(parsed: unknown): ImportBundle {
  const warnings: string[] = [];
  if (!parsed || typeof parsed !== "object") {
    throw new Error("DataFlare export must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  const raw = Array.isArray(obj.connections) ? obj.connections : [];
  const connections: ImportConnection[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const name = String(r.name ?? r.label ?? "Unnamed");
    const provider = String(r.provider ?? r.type ?? r.driver ?? "").toLowerCase();
    const pluginId = DBEAVER_DRIVER_MAP[provider];
    if (!pluginId) {
      warnings.push(`skipped "${name}": unsupported provider "${provider}"`);
      continue;
    }
    connections.push({
      name,
      plugin_id: pluginId,
      host: String(r.host ?? "localhost"),
      port: r.port == null ? null : Number(r.port),
      database: String(r.database ?? r.dbName ?? ""),
      username: String(r.username ?? r.user ?? ""),
      password: String(r.password ?? ""),
      ssl_mode: typeof r.sslMode === "string" ? (r.sslMode as string) : null,
      settings_json: "{}",
      group_name: typeof r.folder === "string" ? (r.folder as string) : null,
      credential_id: null,
    });
  }
  const groupNames = new Set<string>();
  for (const c of connections) {
    if (c.group_name) groupNames.add(c.group_name);
  }
  const groups: ImportGroup[] = Array.from(groupNames).map((name) => ({ name, parent_name: null }));
  return { source: "dataflare", connections, groups, warnings };
}

/** TablePlus .tpc files are AES-encrypted with a passphrase the user sets on
 *  export. We don't have the decrypt routine here, so this parser is a stub
 *  that surfaces a clear error pointing the user at the plaintext JSON path
 *  ("Right click connection → Export connection → Plain JSON"). */
export function parseTablePlus(_text: string): never {
  throw new Error(
    "TablePlus .tpc files are encrypted and not yet supported. " +
      "In TablePlus: right-click a connection → Export connection → choose JSON (plain).",
  );
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Top-level entry: takes raw file text, detects format, parses, returns the
 *  normalized bundle. Throws on parse / validation failure with a message the
 *  caller can surface to the user. */
export function parseImportFile(text: string): ImportBundle {
  let parsed: unknown = null;
  let isJson = false;
  try {
    parsed = JSON.parse(text);
    isJson = true;
  } catch {
    // Could be XML (DataGrip) or invalid. Detect handles that.
  }
  const source = detectFormat(text, parsed);
  switch (source) {
    case "native":
      return parseNative(parsed);
    case "dbeaver":
      return parseDBeaver(parsed);
    case "datagrip":
      return parseDataGrip(text);
    case "dataflare":
      return parseDataFlare(parsed);
    case "tableplus":
      parseTablePlus(text);
      // unreachable
      throw new Error("unreachable");
    case "unknown":
    default:
      if (!isJson) throw new Error("Could not parse file: not valid JSON or DataGrip XML");
      throw new Error("Unknown export format — file does not match native, DBeaver, DataGrip, or DataFlare shapes");
  }
}
