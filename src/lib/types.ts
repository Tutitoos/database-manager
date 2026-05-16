export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string;
  color: string;
  default_port?: number | null;
  capabilities: Record<string, unknown>;
  settings?: Array<{ key: string; label: string; type: string; default?: unknown; required?: boolean }>;
};

export type PluginInfo = {
  id: string;
  name: string;
  version: string;
  description: string;
  path: string;
  enabled: boolean;
  loaded: boolean;
  error?: string | null;
  manifest: PluginManifest;
};

export type Connection = {
  id: number;
  name: string;
  plugin_id: string;
  host: string;
  port?: number | null;
  database: string;
  username: string;
  password: string;
  ssl_mode: string;
  settings_json: string;
  group_id?: number | null;
  enabled: boolean;
  position: number;
  credential_id?: number | null;
  created_at: string;
  updated_at: string;
};

export type ConnectionInput = Omit<Connection, "id" | "position" | "created_at" | "updated_at">;

export type ConnectionGroup = {
  id: number;
  name: string;
  parent_id?: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Credential = {
  id: number;
  name: string;
  username: string;
  encrypted_password: string;
  encrypted_meta: string;
  created_at: string;
  updated_at: string;
};

export type AppUser = {
  user_id: string;
  email: string;
  name?: string | null;
  avatar_url?: string | null;
  linked_providers: string;
  master_key_enc_blob?: string | null;
  session_token_ref?: string | null;
  last_synced_at?: string | null;
};
export type ModalTabId = "general" | "auth" | "advanced" | "databases" | "ssl" | "ssh";
export type ProviderIconName = "postgresql" | "mongodb" | "redis" | "database";
export type ValidationMode = "save" | "test";
export type ValidationField = "name" | "connectionString" | "host" | "port" | "database";

export type ProviderUi = {
  id: string;
  name: string;
  color: string;
  icon: ProviderIconName;
  defaultPort: number;
  tabs: ModalTabId[];
  connectionSchemes: string[];
  connectionPlaceholder: string;
  databaseLabel: string;
  databasePlaceholder: string;
  defaultSettings?: Record<string, unknown>;
  hideUsername?: boolean;
};

export type ParseConnectionStringResult =
  | { ok: true; input: Partial<ConnectionInput>; settings: Record<string, unknown> }
  | { ok: false; error: string };

export type ConnectionUpdater = <K extends keyof ConnectionInput>(key: K, value: ConnectionInput[K]) => void;
export type SettingUpdater = (key: string, value: unknown) => void;

export type TableResult = {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  total: number;
  is_estimated?: boolean;
  next_cursor?: string;
  pk_column?: string;
  query_ms?: number;
};

export type DocumentResult = {
  documents: Record<string, unknown>[];
  total: number;
  query_ms?: number;
  next_cursor?: string;
};

export type KeyValue = {
  key_type: "string" | "list" | "hash" | "set" | "zset";
  value: unknown;
  ttl: number;
};

export type RedisKey = {
  key: string;
  key_type: string;
};
