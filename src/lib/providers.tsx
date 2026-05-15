import { Database } from "lucide-react";
import type { ConnectionInput, ModalTabId, ParseConnectionStringResult, PluginManifest, ProviderUi, ValidationMode } from "./types";

export function getProviderViewType(pluginId: string): "sql" | "document" | "redis" {
  if (pluginId === "mongodb") return "document";
  if (pluginId === "redis") return "redis";
  return "sql";
}

export const emptyConnection: ConnectionInput = {
  name: "",
  plugin_id: "postgresql",
  host: "localhost",
  port: 5432,
  database: "",
  username: "",
  password: "",
  ssl_mode: "disable",
  settings_json: "{}",
  group_id: null,
  enabled: true
};

export const PROVIDER_UI: Record<string, ProviderUi> = {
  postgresql: {
    id: "postgresql",
    name: "PostgreSQL",
    color: "#3B82F6",
    icon: "postgresql",
    defaultPort: 5432,
    tabs: ["general", "auth", "databases", "ssl", "ssh"],
    connectionSchemes: ["postgres", "postgresql"],
    connectionPlaceholder: "postgres://user:pass@localhost:5432/db",
    databaseLabel: "Nombre de la base de datos",
    databasePlaceholder: "Nombre de la base de datos",
    defaultSettings: {}
  },
  mongodb: {
    id: "mongodb",
    name: "MongoDB",
    color: "#13AA52",
    icon: "mongodb",
    defaultPort: 27017,
    tabs: ["general", "auth", "advanced", "databases", "ssh"],
    connectionSchemes: ["mongodb", "mongodb+srv"],
    connectionPlaceholder: "mongodb+srv://user:pass@cluster.mongodb.net/mydb",
    databaseLabel: "Base inicial",
    databasePlaceholder: "mydb",
    defaultSettings: {
      authSource: "admin",
      authMechanism: "SCRAM-SHA-256",
      loadDatabases: true
    }
  },
  redis: {
    id: "redis",
    name: "Redis",
    color: "#DC382D",
    icon: "redis",
    defaultPort: 6379,
    tabs: ["general", "auth", "databases", "ssh"],
    connectionSchemes: ["redis"],
    connectionPlaceholder: "redis://:password@localhost:6379/0",
    databaseLabel: "Database index",
    databasePlaceholder: "0",
    defaultSettings: {},
    hideUsername: true
  }
};

export const TAB_LABELS: Record<ModalTabId, string> = {
  general: "General",
  auth: "Credenciales",
  advanced: "Avanzado",
  databases: "Bases",
  ssl: "SSL",
  ssh: "SSH"
};

export function getProviderUi(pluginId: string, manifest?: PluginManifest): ProviderUi {
  const configured = PROVIDER_UI[pluginId];
  if (configured) return configured;
  return {
    id: pluginId,
    name: manifest?.name ?? pluginId,
    color: manifest?.color ?? "#71717A",
    icon: "database",
    defaultPort: manifest?.default_port ?? 0,
    tabs: ["general", "auth", "databases", "ssh"],
    connectionSchemes: [pluginId],
    connectionPlaceholder: `${pluginId}://user:pass@localhost/db`,
    databaseLabel: String(manifest?.capabilities.database_label ?? "Database"),
    databasePlaceholder: "default"
  };
}

export function ProviderIcon({ providerId, className }: { providerId: string; className?: string }) {
  const icon = getProviderUi(providerId).icon;
  if (icon === "postgresql") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none">
        <path d="M7.1 14.2c-1.7-.8-2.7-2.3-2.7-4.4 0-3.2 2.4-5.6 5.9-5.6h2.2c4.3 0 7.1 2.7 7.1 6.8v2.1c0 2.2-1 3.6-2.7 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M8.1 18.3c.7 1 2.1 1.5 3.9 1.5s3.2-.5 3.9-1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M9 9.2h.1M14.9 9.2h.1" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
        <path d="M10.3 12.4c.5.4 1.1.6 1.7.6s1.2-.2 1.7-.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M7.1 14.2 5 18.8M16.9 14.2l2.1 4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (icon === "mongodb") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none">
        <path d="M12 3.2c3.4 3 5.1 5.8 5.1 8.6 0 3.7-2.1 6.2-5.1 7.1-3-.9-5.1-3.4-5.1-7.1 0-2.8 1.7-5.6 5.1-8.6Z" fill="currentColor" />
        <path d="M12 7.3v12.9" stroke="rgba(255,255,255,.75)" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  if (icon === "redis") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none">
        <path d="m12 4 7.5 3.4L12 10.8 4.5 7.4 12 4Z" fill="currentColor" />
        <path d="m5.3 11 6.7 3 6.7-3M5.3 15l6.7 3 6.7-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return <Database className={className} />;
}

export function parseSettings(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

export function stringifySettings(settings: Record<string, unknown>) {
  return JSON.stringify(settings, null, 2);
}

export function withoutConnectionStringState(settings: Record<string, unknown>) {
  const { connectionStringRaw: _raw, connectionStringError: _error, ...rest } = settings;
  return rest;
}

export function buildConnectionString(form: ConnectionInput, provider: ProviderUi) {
  const scheme = provider.id === "postgresql" ? "postgres" : provider.id === "mongodb" ? "mongodb" : provider.id === "redis" ? "redis" : provider.id;
  const encodedUser = encodeURIComponent(form.username);
  const encodedPassword = encodeURIComponent(form.password);
  const credentials = provider.hideUsername
    ? form.password ? `:${encodedPassword}@` : ""
    : form.username ? `${encodedUser}${form.password ? `:${encodedPassword}` : ""}@` : "";
  const port = form.port ? `:${form.port}` : "";
  const database = form.database ? `/${encodeURIComponent(form.database)}` : "";
  const value = `${scheme}://${credentials}${form.host || "localhost"}${port}${database}`;
  return value === `${scheme}://localhost` ? provider.connectionPlaceholder : value;
}

export function parseConnectionString(value: string, provider: ProviderUi): ParseConnectionStringResult {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "Connection string inválido." };
  }

  const scheme = url.protocol.replace(":", "");
  if (!provider.connectionSchemes.includes(scheme)) {
    return { ok: false, error: `El esquema "${scheme}" no corresponde a ${provider.name}.` };
  }

  const host = url.hostname;
  if (!host) return { ok: false, error: "El connection string debe incluir host." };

  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  const parsedPort = url.port ? Number(url.port) : provider.defaultPort;
  if (!Number.isFinite(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    return { ok: false, error: "El puerto del connection string no es válido." };
  }

  const params = url.searchParams;
  const settings: Record<string, unknown> = {};
  const input: Partial<ConnectionInput> = {
    host,
    port: parsedPort,
    database,
    username: provider.hideUsername ? "" : decodeURIComponent(url.username),
    password: decodeURIComponent(url.password)
  };

  if (provider.id === "postgresql") {
    const sslMode = params.get("sslmode");
    if (sslMode) input.ssl_mode = sslMode;
  }

  if (provider.id === "mongodb") {
    input.database = database;
    settings.authSource = params.get("authSource") ?? params.get("authsource") ?? "admin";
    const replicaSet = params.get("replicaSet");
    if (replicaSet) settings.replicaSet = replicaSet;
    const authMechanism = params.get("authMechanism");
    if (authMechanism) settings.authMechanism = authMechanism;
    settings.useAtlasStableAPI = params.get("serverApi") === "1" || params.get("useAtlasStableAPI") === "true";
    if (scheme === "mongodb+srv") {
      settings.isSrvConnection = true;
      input.port = null;
    }
  }

  if (provider.id === "redis") {
    input.database = database || "0";
    input.username = "";
  }

  return { ok: true, input, settings };
}

export function validateConnection(form: ConnectionInput, provider: ProviderUi, connectionStringError: string, mode: ValidationMode) {
  const errors: Record<string, string> = {};
  if (mode === "save" && !form.name.trim()) errors.name = "El nombre de la conexión es requerido.";
  if (!form.host.trim()) errors.host = "El host es requerido.";
  if (form.port !== null && form.port !== undefined) {
    if (!Number.isFinite(Number(form.port)) || Number(form.port) < 1 || Number(form.port) > 65535) {
      errors.port = "El puerto debe estar entre 1 y 65535.";
    }
  } else if (provider.id !== "mongodb") {
    errors.port = "El puerto es requerido.";
  }
  if (mode === "save" && (provider.id === "postgresql" || provider.id === "redis") && !String(form.database ?? "").trim()) {
    errors.database = provider.id === "redis" ? "El índice de database es requerido." : "La base de datos es requerida.";
  }
  if (provider.id === "redis" && String(form.database ?? "").trim()) {
    const databaseIndex = Number(form.database);
    if (!Number.isInteger(databaseIndex) || databaseIndex < 0) {
      errors.database = "El índice de database debe ser un número entero mayor o igual a 0.";
    }
  }
  if (connectionStringError) errors.connectionString = connectionStringError;
  return errors;
}

export function filterVisibleValidation(
  errors: Record<string, string>,
  touchedFields: Partial<Record<string, boolean>>,
  submitMode: ValidationMode | null
) {
  if (submitMode) return errors;
  return Object.fromEntries(
    Object.entries(errors).filter(([field]) => Boolean(touchedFields[field]))
  );
}

export function markFields(errors: Record<string, string>) {
  return Object.fromEntries(Object.keys(errors).map((field) => [field, true])) as Record<string, boolean>;
}

export function getNextProviderDatabase(pluginId: string, currentDatabase: string) {
  if (pluginId !== "redis") return currentDatabase;
  const databaseIndex = Number(currentDatabase);
  return Number.isInteger(databaseIndex) && databaseIndex >= 0 ? String(databaseIndex) : "0";
}
