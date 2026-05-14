"use client";

import { invoke } from "@tauri-apps/api/core";
import {
  Boxes,
  CheckCircle2,
  CirclePower,
  Copy,
  Database,
  Eye,
  EyeOff,
  Grid2X2,
  KeyRound,
  List,
  Loader2,
  Network,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Trash2,
  X,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type PluginManifest = {
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

type PluginInfo = {
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

type Connection = {
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
  created_at: string;
  updated_at: string;
};

type ConnectionInput = Omit<Connection, "id" | "created_at" | "updated_at">;
type ModalTabId = "general" | "auth" | "advanced" | "databases" | "ssl" | "ssh";
type ProviderIconName = "postgresql" | "mongodb" | "redis" | "database";
type ValidationMode = "save" | "test";
type ValidationField = "name" | "connectionString" | "host" | "port" | "database";

type ProviderUi = {
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

const emptyConnection: ConnectionInput = {
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

const PROVIDER_UI: Record<string, ProviderUi> = {
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

const TAB_LABELS: Record<ModalTabId, string> = {
  general: "General",
  auth: "Credenciales",
  advanced: "Avanzado",
  databases: "Bases",
  ssl: "SSL",
  ssh: "SSH"
};

const appBg = "bg-[#050505]";
const panel = "bg-[#0a0a0a]";
const surface = "border border-zinc-800 bg-[#0f0f10]";
const mutedText = "text-zinc-400";
const softText = "text-zinc-500";
const hoverSurface = "transition-colors hover:border-zinc-700/80 hover:bg-[#151515]";
const sectionBorder = "border-zinc-800/80";

export default function Home() {
  const [view, setView] = useState<"connections" | "plugins">("connections");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [form, setForm] = useState<ConnectionInput>(emptyConnection);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [statusOk, setStatusOk] = useState<boolean>(false);

  async function refresh() {
    const [nextConnections, nextPlugins] = await Promise.all([
      invoke<Connection[]>("list_connections"),
      invoke<PluginInfo[]>("list_plugins")
    ]);
    setConnections(nextConnections);
    setPlugins(nextPlugins);
  }

  useEffect(() => {
    refresh().catch((error) => setStatus(String(error)));
  }, []);

  useEffect(() => {
    if (status && !dialogOpen) {
      const id = setTimeout(() => setStatus(""), 3500);
      return () => clearTimeout(id);
    }
  }, [status, dialogOpen]);

  const enabledPlugins = plugins.filter((plugin) => plugin.enabled);
  const pluginMap = useMemo(() => new Map(plugins.map((plugin) => [plugin.id, plugin])), [plugins]);
  const visibleConnections = connections.filter((connection) => {
    const text = `${connection.name} ${connection.plugin_id} ${connection.host} ${connection.database}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });

  function openCreate() {
    const first = enabledPlugins[0]?.manifest;
    const provider = getProviderUi(first?.id ?? "postgresql", first);
    setEditing(null);
    setForm({
      ...emptyConnection,
      plugin_id: provider.id,
      port: first?.default_port ?? provider.defaultPort,
      database: provider.id === "redis" ? "0" : "",
      username: provider.hideUsername ? "" : "",
      ssl_mode: provider.id === "postgresql" ? "disable" : "",
      settings_json: stringifySettings(provider.defaultSettings ?? {})
    });
    setStatus("");
    setDialogOpen(true);
  }

  function openEdit(connection: Connection) {
    setEditing(connection);
    setForm({
      name: connection.name,
      plugin_id: connection.plugin_id,
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      ssl_mode: connection.ssl_mode,
      settings_json: connection.settings_json,
      group_id: connection.group_id,
      enabled: connection.enabled
    });
    setStatus("");
    setDialogOpen(true);
  }

  async function saveConnection(connectionForm: ConnectionInput) {
    setBusy(true);
    setStatus("");
    try {
      if (editing) {
        await invoke("update_connection", { id: editing.id, input: connectionForm });
      } else {
        await invoke("create_connection", { input: connectionForm });
      }
      setDialogOpen(false);
      await refresh();
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function testConnection(input: ConnectionInput | Connection) {
    setBusy(true);
    setStatus("");
    try {
      await invoke("test_connection", { input });
      setStatus("Conexión correcta.");
      setStatusOk(true);
    } catch (error) {
      setStatus(String(error));
      setStatusOk(false);
    } finally {
      setBusy(false);
    }
  }

  async function deleteConnection(id: number) {
    await invoke("delete_connection", { id });
    await refresh();
  }

  async function duplicateConnection(connection: Connection) {
    const { id: _id, created_at: _created, updated_at: _updated, ...input } = connection;
    await invoke("create_connection", { input: { ...input, name: `${connection.name} copia` } });
    await refresh();
  }

  async function setPluginEnabled(plugin: PluginInfo, enabled: boolean) {
    setStatus("");
    try {
      await invoke(enabled ? "enable_plugin" : "disable_plugin", { pluginId: plugin.id });
      await refresh();
    } catch (error) {
      setStatus(String(error));
      await refresh();
    }
  }

  async function rescanPlugins() {
    setBusy(true);
    try {
      await invoke("rescan_plugins");
      await refresh();
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={cn("min-h-screen p-4 text-zinc-100", appBg)}>
      <section className={cn("mx-auto flex h-[calc(100vh-32px)] max-w-[1320px] overflow-hidden rounded-lg shadow-[0_0_0_1px_rgba(255,255,255,.04)]", surface)}>
        <aside className={cn("flex w-14 flex-col items-center border-r", panel, sectionBorder)}>
          <div className="mt-4 grid h-9 w-9 place-items-center rounded-md border border-zinc-700/70 bg-[#101010] text-zinc-100">
            <Boxes className="h-5 w-5" />
          </div>
          <nav className="mt-10 flex flex-1 flex-col gap-2">
            <IconButton active={view === "connections"} onClick={() => setView("connections")} label="Conexiones">
              <Plug className="h-5 w-5" />
            </IconButton>
            <IconButton active={view === "plugins"} onClick={() => setView("plugins")} label="Plugins">
              <Settings className="h-5 w-5" />
            </IconButton>
          </nav>
        </aside>

        {view === "connections" ? (
          <ConnectionsView
            connections={visibleConnections}
            total={connections.length}
            query={query}
            setQuery={setQuery}
            pluginMap={pluginMap}
            onCreate={openCreate}
            onEdit={openEdit}
            onDelete={deleteConnection}
            onDuplicate={duplicateConnection}
            onTest={testConnection}
          />
        ) : (
          <PluginsView plugins={plugins} busy={busy} onRefresh={rescanPlugins} onToggle={setPluginEnabled} />
        )}
      </section>

      <ConnectionDialog
        open={dialogOpen}
        form={form}
        plugins={enabledPlugins}
        busy={busy}
        status={status}
        statusOk={statusOk}
        editing={editing}
        setForm={setForm}
        onOpenChange={setDialogOpen}
        onSave={saveConnection}
        onTest={() => testConnection(form)}
        onValidate={(msg, ok) => { setStatus(msg); setStatusOk(ok); }}
      />

      {status && !dialogOpen && (
        <div className={cn(
          "fixed bottom-5 right-5 flex max-w-md items-center gap-2 rounded-md border px-4 py-3 text-sm shadow-[0_16px_48px_rgba(0,0,0,.55)]",
          statusOk
            ? "border-green-900/50 bg-green-950/30 text-green-300"
            : "border-red-900/50 bg-red-950/30 text-red-300"
        )}>
          {statusOk ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
          {status}
        </div>
      )}
    </main>
  );
}

function IconButton({ active, label, children, onClick }: { active: boolean; label: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={cn(
        "grid h-9 w-9 place-items-center rounded-md border border-transparent text-zinc-400 transition-colors hover:border-zinc-700/70 hover:bg-zinc-900 hover:text-zinc-100",
        active && "border-zinc-700 bg-zinc-900 text-white"
      )}
    >
      {children}
    </button>
  );
}

function ConnectionsView(props: {
  connections: Connection[];
  total: number;
  query: string;
  setQuery: (query: string) => void;
  pluginMap: Map<string, PluginInfo>;
  onCreate: () => void;
  onEdit: (connection: Connection) => void;
  onDelete: (id: number) => void;
  onDuplicate: (connection: Connection) => void;
  onTest: (connection: Connection) => void;
}) {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  return (
    <div className={cn("flex min-w-0 flex-1 flex-col", panel)}>
      <header className={cn("flex h-20 items-center justify-between border-b px-6", panel, sectionBorder)}>
        <div>
          <div className={cn("flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em]", mutedText)}>
            <Database className="h-3.5 w-3.5" />
            Database Manager
          </div>
          <h1 className="mt-2 text-xl font-semibold tracking-[-.01em] text-white">Conexiones</h1>
          <p className={cn("mt-0.5 text-xs", mutedText)}>{props.total} conexión/es</p>
        </div>
        <Button variant="primary" onClick={props.onCreate}>
          <Plus className="h-4 w-4" />
          Agregar Conexión
        </Button>
      </header>

      <div className={cn("flex min-w-0 items-center gap-2 border-b px-5 py-3", panel, sectionBorder)}>
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
          <Input className="pl-9" placeholder="Buscar conexiones..." value={props.query} onChange={(event) => props.setQuery(event.target.value)} />
        </div>
        <IconButton active={viewMode === "grid"} label="Vista cuadrícula" onClick={() => setViewMode("grid")}>
          <Grid2X2 className="h-4 w-4" />
        </IconButton>
        <IconButton active={viewMode === "list"} label="Vista lista" onClick={() => setViewMode("list")}>
          <List className="h-4 w-4" />
        </IconButton>
      </div>

      {viewMode === "grid" && (
        <div className="grid min-w-0 grid-cols-1 content-start gap-3 overflow-x-hidden overflow-y-auto p-5 lg:grid-cols-2 xl:grid-cols-3">
          {props.connections.length === 0 && (
            <div className={cn("col-span-full flex min-h-64 flex-col items-center justify-center rounded-lg p-8 text-center", surface)}>
              <div className="grid h-10 w-10 place-items-center rounded-md border border-zinc-700/70 bg-[#101010] text-zinc-400">
                <Database className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-sm font-medium text-white">No hay conexiones</h2>
              <p className={cn("mt-1 max-w-sm text-sm", mutedText)}>Crea una conexión local para PostgreSQL, MongoDB o Redis.</p>
            </div>
          )}
          {props.connections.map((connection) => {
            const plugin = props.pluginMap.get(connection.plugin_id);
            return (
              <article key={connection.id} className={cn("rounded-lg p-4", surface, hoverSurface)}>
                <div className="flex gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-white" style={{ backgroundColor: getProviderUi(connection.plugin_id, plugin?.manifest).color }}>
                    <ProviderIcon providerId={connection.plugin_id} className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-white">{connection.name}</h3>
                    <Badge className="mt-1">{plugin?.name ?? connection.plugin_id}</Badge>
                    <p className={cn("mt-3 truncate text-xs", softText)}>
                      {connection.host}:{connection.port ?? "-"}
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex justify-end gap-1 text-zinc-500">
                  <Button variant="ghost" size="icon" title="Probar" onClick={() => props.onTest(connection)}>
                    <CirclePower className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Editar" onClick={() => props.onEdit(connection)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Duplicar" onClick={() => props.onDuplicate(connection)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Eliminar" onClick={() => props.onDelete(connection.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {viewMode === "list" && (
        <div className="flex min-w-0 flex-col gap-1 overflow-x-hidden overflow-y-auto p-5">
          {props.connections.length === 0 && (
            <div className={cn("flex min-h-64 flex-col items-center justify-center rounded-lg p-8 text-center", surface)}>
              <div className="grid h-10 w-10 place-items-center rounded-md border border-zinc-700/70 bg-[#101010] text-zinc-400">
                <Database className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-sm font-medium text-white">No hay conexiones</h2>
              <p className={cn("mt-1 max-w-sm text-sm", mutedText)}>Crea una conexión local para PostgreSQL, MongoDB o Redis.</p>
            </div>
          )}
          {props.connections.map((connection) => {
            const plugin = props.pluginMap.get(connection.plugin_id);
            return (
              <div key={connection.id} className={cn("flex items-center gap-3 rounded-md px-3 py-2", surface, hoverSurface)}>
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-white" style={{ backgroundColor: getProviderUi(connection.plugin_id, plugin?.manifest).color }}>
                  <ProviderIcon providerId={connection.plugin_id} className="h-3.5 w-3.5" />
                </div>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{connection.name}</span>
                <Badge className="shrink-0">{plugin?.name ?? connection.plugin_id}</Badge>
                <span className={cn("shrink-0 text-xs", softText)}>{connection.host}:{connection.port ?? "-"}</span>
                <div className="flex shrink-0 gap-1 text-zinc-500">
                  <Button variant="ghost" size="icon" title="Probar" onClick={() => props.onTest(connection)}>
                    <CirclePower className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Editar" onClick={() => props.onEdit(connection)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Duplicar" onClick={() => props.onDuplicate(connection)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Eliminar" onClick={() => props.onDelete(connection.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PluginsView({ plugins, busy, onRefresh, onToggle }: { plugins: PluginInfo[]; busy: boolean; onRefresh: () => void; onToggle: (plugin: PluginInfo, enabled: boolean) => void }) {
  const enabled = plugins.filter((plugin) => plugin.enabled).length;
  const [pluginsTab, setPluginsTab] = useState<"instalados" | "marketplace">("instalados");
  const [settingsSection, setSettingsSection] = useState<"general" | "plugins">("general");

  return (
    <div className={cn("flex min-w-0 flex-1", panel)}>
      <aside className={cn("w-48 border-r p-3", panel, sectionBorder)}>
        <SideItem active={settingsSection === "general"} icon={<Settings className="h-4 w-4" />} label="General" onClick={() => setSettingsSection("general")} />
        <SideItem active={settingsSection === "plugins"} icon={<Plug className="h-4 w-4" />} label="Plugins" count={plugins.length} onClick={() => setSettingsSection("plugins")} />
      </aside>
      <section className={cn("min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-6", panel)}>
        {settingsSection === "general" && <GeneralSection />}
        {settingsSection === "plugins" && <>
          <div className={cn("rounded-lg", surface)}>
            <div className={cn("flex items-center justify-between border-b p-5", sectionBorder)}>
              <div className="flex items-center gap-4">
                <div className="grid h-9 w-9 place-items-center rounded-md border border-zinc-700/70 bg-[#101010] text-zinc-200">
                  <Plug className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-lg font-semibold tracking-[-.01em] text-white">Centro de plugins</h1>
                  <p className={cn("text-xs", mutedText)}>Instala extensiones, gestiona drivers y mantén bajo control la ejecución.</p>
                </div>
              </div>
              <Button onClick={onRefresh} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Actualizar
              </Button>
            </div>
            <div className="grid grid-cols-3 divide-x divide-zinc-900">
              <Metric label="Instalados" value={plugins.length} />
              <Metric label="Habilitados" value={enabled} />
              <Metric label="Registro local" value={plugins.length} />
            </div>
          </div>

          <div className={cn("mt-5 flex h-10 items-end gap-5 border-b", sectionBorder)}>
            <button
              onClick={() => setPluginsTab("instalados")}
              className={cn("flex items-center gap-1.5 border-b-2 pb-2 text-xs font-medium transition-colors", pluginsTab === "instalados" ? "border-blue-500 text-white" : "border-transparent text-zinc-500 hover:text-zinc-300")}
            >
              <Plug className="h-3.5 w-3.5" />
              Instalados
            </button>
            <button
              onClick={() => setPluginsTab("marketplace")}
              className={cn("flex items-center gap-1.5 border-b-2 pb-2 text-xs font-medium transition-colors", pluginsTab === "marketplace" ? "border-blue-500 text-white" : "border-transparent text-zinc-500 hover:text-zinc-300")}
            >
              <Boxes className="h-3.5 w-3.5" />
              Marketplace
            </button>
          </div>

          {pluginsTab === "marketplace" && (
            <div className="mt-10 flex flex-col items-center justify-center py-16 text-center">
              <div className="grid h-10 w-10 place-items-center rounded-md border border-zinc-700/70 bg-[#101010] text-zinc-400">
                <Boxes className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-sm font-medium text-white">Próximamente</h2>
              <p className={cn("mt-1 max-w-sm text-xs", mutedText)}>El marketplace de plugins estará disponible en una próxima versión.</p>
            </div>
          )}

          {pluginsTab === "instalados" && <>
            <div className="mt-7 flex items-center justify-between">
              <div>
                <p className={cn("text-[10px] font-semibold uppercase tracking-[.16em]", mutedText)}>Plugins disponibles</p>
                <p className={cn("text-xs", softText)}>Explora plugins detectados en la carpeta local.</p>
              </div>
              <div className="relative w-56">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                <Input className="pl-9" placeholder="Buscar plugins..." />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
              {plugins.map((plugin) => (
                <article key={plugin.id} className={cn("overflow-hidden rounded-lg", surface, hoverSurface)}>
                  <div className={cn("flex items-center gap-3 border-b p-4", sectionBorder)}>
                    <div className="grid h-8 w-8 place-items-center rounded-md text-white" style={{ backgroundColor: getProviderUi(plugin.id, plugin.manifest).color }}>
                      <ProviderIcon providerId={plugin.id} className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-white">{plugin.name}</h3>
                      <p className={cn("truncate text-xs", mutedText)}>v{plugin.version}</p>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className={cn("text-xs", mutedText)}>{plugin.description}</p>
                      </div>
                      {plugin.loaded ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-zinc-500" />}
                    </div>
                    {plugin.error && (
                      <div className="mt-3 rounded-md border border-red-900/60 bg-red-950/20 p-2 text-xs text-red-200">
                        <p>{plugin.error}</p>
                        {plugin.error.includes("EOF") && (
                          <p className="mt-1 text-red-400/80">Ejecuta <code className="font-mono">pnpm plugins:build</code> para recompilar los plugins.</p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className={cn("flex items-center justify-between border-t px-4 py-3", sectionBorder)}>
                    <span className="max-w-[70%] truncate text-xs text-zinc-500">{plugin.path}</span>
                    <div className="flex items-center gap-3">
                      <span className={cn("text-xs", softText)}>{plugin.enabled ? "Activo" : "Inactivo"}</span>
                      <Switch checked={plugin.enabled} onCheckedChange={(checked) => onToggle(plugin, checked)} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>}
        </>}
      </section>
    </div>
  );
}

function GeneralSection() {
  const [confirmDelete, setConfirmDelete] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("setting:confirmDelete");
    return stored === null ? true : stored === "true";
  });

  function toggleConfirmDelete(value: boolean) {
    setConfirmDelete(value);
    localStorage.setItem("setting:confirmDelete", String(value));
  }

  return (
    <div>
      <div className={cn("rounded-lg", surface)}>
        <div className={cn("flex items-center gap-4 border-b p-5", sectionBorder)}>
          <div className="grid h-9 w-9 place-items-center rounded-md border border-zinc-700/70 bg-[#101010] text-zinc-200">
            <Settings className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-[-.01em] text-white">Ajustes generales</h1>
            <p className={cn("text-xs", mutedText)}>Configura el comportamiento global de la aplicación.</p>
          </div>
        </div>
      </div>

      <div className={cn("mt-5 rounded-lg", surface)}>
        <div className={cn("border-b px-5 py-3", sectionBorder)}>
          <p className={cn("text-[10px] font-semibold uppercase tracking-[.16em]", mutedText)}>Conexiones</p>
        </div>
        <div className={cn("flex items-center justify-between border-b px-5 py-4", sectionBorder)}>
          <div>
            <p className="text-sm text-white">Confirmar antes de eliminar</p>
            <p className={cn("mt-0.5 text-xs", mutedText)}>Muestra un diálogo de confirmación al eliminar una conexión.</p>
          </div>
          <Switch checked={confirmDelete} onCheckedChange={toggleConfirmDelete} />
        </div>
      </div>
    </div>
  );
}

function SideItem({ active, icon, label, count, onClick }: { active?: boolean; icon: React.ReactNode; label: string; count?: number; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={cn("mb-1 flex h-8 items-center gap-3 rounded-md border border-transparent px-3 text-sm text-zinc-400", active && "border-zinc-700/70 bg-zinc-900 text-white", onClick && "cursor-pointer hover:text-zinc-200")}>
      {icon}
      <span className="flex-1">{label}</span>
      {count !== undefined && <Badge>{count}</Badge>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-4">
      <div className="text-xl font-semibold tracking-[-.02em] text-white">{value}</div>
      <div className={cn("mt-1 text-xs", mutedText)}>{label}</div>
    </div>
  );
}

function parseSettings(value: string): Record<string, unknown> {
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

function stringifySettings(settings: Record<string, unknown>) {
  return JSON.stringify(settings, null, 2);
}

function withoutConnectionStringState(settings: Record<string, unknown>) {
  const { connectionStringRaw: _raw, connectionStringError: _error, ...rest } = settings;
  return rest;
}

function ConnectionDialog(props: {
  open: boolean;
  form: ConnectionInput;
  plugins: PluginInfo[];
  busy: boolean;
  status: string;
  statusOk: boolean;
  editing: Connection | null;
  setForm: (form: ConnectionInput) => void;
  onOpenChange: (open: boolean) => void;
  onSave: (form: ConnectionInput) => void;
  onTest: () => void;
  onValidate: (message: string, ok: boolean) => void;
}) {
  const [activeTab, setActiveTab] = useState<ModalTabId>("general");
  const [connectionStringError, setConnectionStringError] = useState("");
  const [touchedFields, setTouchedFields] = useState<Partial<Record<ValidationField, boolean>>>({});
  const [submitMode, setSubmitMode] = useState<ValidationMode | null>(null);
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const [databaseLoadError, setDatabaseLoadError] = useState("");
  const [loadedDatabases, setLoadedDatabases] = useState<string[]>([]);
  const [selectedDatabases, setSelectedDatabases] = useState<Set<string>>(new Set());
  const [collectionsPerDb, setCollectionsPerDb] = useState<Record<string, string[]>>({});
  const [selectedCollections, setSelectedCollections] = useState<Record<string, Set<string>>>({});
  const [collectionsSource, setCollectionsSource] = useState<Record<string, "saved" | "server">>({});
  const [dbsSource, setDbsSource] = useState<Record<string, "saved" | "server">>({});
  const [loadingCollections, setLoadingCollections] = useState<Record<string, boolean>>({});
  const [collectionsError, setCollectionsError] = useState<Record<string, string>>({});
  const [activeDbTab, setActiveDbTab] = useState<string>("");
  const selected = props.plugins.find((plugin) => plugin.id === props.form.plugin_id);
  const provider = getProviderUi(props.form.plugin_id, selected?.manifest);
  const settings = parseSettings(props.form.settings_json);
  const connectionString = typeof settings.connectionStringRaw === "string"
    ? settings.connectionStringRaw
    : buildConnectionString(props.form, provider);
  const visibleTab = provider.tabs.includes(activeTab) ? activeTab : "general";
  const saveValidation = validateConnection(props.form, provider, connectionStringError, "save");
  const testValidation = validateConnection(props.form, provider, connectionStringError, "test");
  const activeValidation = submitMode === "test" ? testValidation : saveValidation;
  const visibleValidation = filterVisibleValidation(activeValidation, touchedFields, submitMode);

  useEffect(() => {
    if (!provider.tabs.includes(activeTab)) {
      setActiveTab("general");
    }
  }, [activeTab, provider.tabs, props.form.plugin_id]);

  useEffect(() => {
    if (props.open) {
      setTouchedFields({});
      setSubmitMode(null);
      setConnectionStringError("");
      setDatabaseLoadError("");
      setLoadingDatabases(false);
      setLoadingCollections({});
      setCollectionsError({});
      setActiveTab("general");

      // Restaurar selecciones previas si se está editando una conexión
      if (props.editing) {
        const editingSettings = parseSettings(props.editing.settings_json);
        const prevSelectedDbs = Array.isArray(editingSettings.selectedDatabases) 
          ? editingSettings.selectedDatabases 
          : [];
        const prevSelectedCollections = editingSettings.selectedCollections && typeof editingSettings.selectedCollections === 'object'
          ? (editingSettings.selectedCollections as Record<string, unknown>)
          : {};
        
        setSelectedDatabases(new Set(prevSelectedDbs));
        // Ensure the DB list shows restored DBs so badges and per-DB controls are visible
        setLoadedDatabases(prevSelectedDbs);
        // Restore collectionsPerDb from saved selections so they are editable without reloading
        const restoredCollectionsPerDb: Record<string, string[]> = Object.fromEntries(
          Object.entries(prevSelectedCollections).map(([db, collections]) => [
            db,
            Array.isArray(collections) ? (collections as string[]) : []
          ])
        );
        setCollectionsPerDb(restoredCollectionsPerDb);
        // mark restored collections as coming from saved settings
        const restoredSource: Record<string, "saved" | "server"> = {};
        Object.keys(restoredCollectionsPerDb).forEach((db) => {
          restoredSource[db] = "saved";
        });
        setCollectionsSource(restoredSource);
        // mark selected DBs as cacheada
        const restoredDbsSource: Record<string, "saved" | "server"> = {};
        prevSelectedDbs.forEach((db: string) => {
          restoredDbsSource[db] = "saved";
        });
        setDbsSource(restoredDbsSource);
        setSelectedCollections(
          Object.fromEntries(
            Object.entries(prevSelectedCollections).map(([db, collections]) => [
              db,
              new Set(Array.isArray(collections) ? (collections as string[]) : [])
            ])
          )
        );
        
        if (prevSelectedDbs.length > 0) {
          setActiveDbTab(prevSelectedDbs[0]);
        }
      } else {
        setLoadedDatabases([]);
        setSelectedDatabases(new Set());
        setCollectionsPerDb({});
        setSelectedCollections({});
        setActiveDbTab("");
      }
    }
  }, [props.open, props.editing?.id]);

  function touch(field: ValidationField) {
    setTouchedFields((current) => ({ ...current, [field]: true }));
  }

  function update<K extends keyof ConnectionInput>(key: K, value: ConnectionInput[K]) {
    const clearsRaw = ["host", "port", "database", "username", "password", "ssl_mode"].includes(String(key));
    const nextSettings = clearsRaw ? withoutConnectionStringState(settings) : settings;
    if (clearsRaw) setConnectionStringError("");
    props.setForm({ ...props.form, [key]: value, settings_json: stringifySettings(nextSettings) });
  }

  function updateSetting(key: string, value: unknown) {
    props.setForm({
      ...props.form,
      settings_json: stringifySettings({ ...settings, [key]: value })
    });
  }

  function handleConnectionStringChange(value: string) {
    touch("connectionString");
    if (!value.trim()) {
      setConnectionStringError("");
      props.setForm({
        ...props.form,
        settings_json: stringifySettings(withoutConnectionStringState(settings))
      });
      return;
    }

    const parsed = parseConnectionString(value, provider);
    if (!parsed.ok) {
      setConnectionStringError(parsed.error);
      props.setForm({
        ...props.form,
        settings_json: stringifySettings({ ...settings, connectionStringRaw: value })
      });
      return;
    }

    setConnectionStringError("");
    props.setForm({
      ...props.form,
      ...parsed.input,
      settings_json: stringifySettings({
        ...settings,
        ...parsed.settings,
        connectionStringRaw: value
      })
    });
  }

  function selectPlugin(plugin: PluginInfo) {
    const nextProvider = getProviderUi(plugin.id, plugin.manifest);
    setConnectionStringError("");
    setDatabaseLoadError("");
    setTouchedFields({});
    setSubmitMode(null);
    props.setForm({
      name: props.form.name,
      group_id: props.form.group_id,
      enabled: props.form.enabled,
      plugin_id: plugin.id,
      host: "localhost",
      port: plugin.manifest.default_port ?? nextProvider.defaultPort,
      database: getNextProviderDatabase(plugin.id, ""),
      username: "",
      password: "",
      ssl_mode: plugin.id === "postgresql" ? "disable" : "",
      settings_json: stringifySettings(nextProvider.defaultSettings ?? {}),
    });
    setLoadedDatabases([]);
    setSelectedDatabases(new Set());
    setCollectionsPerDb({});
    setSelectedCollections({});
    setCollectionsSource({});
    setDbsSource({});
    setLoadingCollections({});
    setCollectionsError({});
    setActiveDbTab("");
    setActiveTab("general");
  }

  async function loadDatabases() {
    setLoadingDatabases(true);
    setDatabaseLoadError("");
    try {
      const databases = await invoke<string[]>("list_databases", { input: props.form });
      const availableDatabases = new Set(databases);
      const retainedSelected = new Set(
        Array.from(selectedDatabases).filter((db) => availableDatabases.has(db))
      );

      setLoadedDatabases(databases);
      // mark dbs as coming from server
      const serverSource: Record<string, "saved" | "server"> = {};
      databases.forEach((db) => (serverSource[db] = "server"));
      setDbsSource(serverSource);
      // Keep any previously selected DB that still exists after reloading from server
      setSelectedDatabases(retainedSelected);
      // Keep collections/selections only for DBs that still exist
      setCollectionsPerDb((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([db]) => availableDatabases.has(db)))
      );
      setSelectedCollections((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([db]) => availableDatabases.has(db)))
      );
      setCollectionsSource((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([db]) => availableDatabases.has(db)))
      );
      if (activeDbTab && retainedSelected.has(activeDbTab)) {
        setActiveDbTab(activeDbTab);
      } else if (retainedSelected.size > 0) {
        setActiveDbTab(Array.from(retainedSelected)[0]);
      } else {
        setActiveDbTab("");
      }
    } catch (error) {
      setDatabaseLoadError(String(error));
    } finally {
      setLoadingDatabases(false);
    }
  }

  async function loadCollectionsForDatabase(database: string) {
    setLoadingCollections((prev) => ({ ...prev, [database]: true }));
    setCollectionsError((prev) => ({ ...prev, [database]: "" }));
    try {
      const collections = await invoke<string[]>("list_collections", { 
        input: props.form, 
        database 
      });
      setCollectionsPerDb((prev) => ({ ...prev, [database]: collections }));
      // mark that this DB's collections came from the server
      setCollectionsSource((prev) => ({ ...prev, [database]: "server" }));
      // If selections already exist (e.g. when editing), keep them; otherwise select all by default
      setSelectedCollections((prev) => ({ ...prev, [database]: prev[database] ? new Set(Array.from(prev[database])) : new Set(collections) }));
    } catch (error) {
      setCollectionsError((prev) => ({ ...prev, [database]: String(error) }));
    } finally {
      setLoadingCollections((prev) => ({ ...prev, [database]: false }));
    }
  }

  function toggleDatabaseSelection(database: string) {
    const newSelected = new Set(selectedDatabases);
    if (newSelected.has(database)) {
      newSelected.delete(database);
      const newCollections = { ...selectedCollections };
      delete newCollections[database];
      setSelectedCollections(newCollections);
      // remove db source when deselected
      setDbsSource((prev) => { const copy = { ...prev }; delete copy[database]; return copy; });
      
      // If the deleted database was the active tab, switch to another or clear
      if (activeDbTab === database) {
        if (newSelected.size > 0) {
          setActiveDbTab(Array.from(newSelected)[0]);
        } else {
          setActiveDbTab("");
        }
      }
    } else {
      newSelected.add(database);
      if (provider.id !== "redis") {
        loadCollectionsForDatabase(database);
      }
      setDbsSource((prev) => ({ ...prev, [database]: prev[database] || "server" }));
      if (!activeDbTab) {
        setActiveDbTab(database);
      }
    }
    setSelectedDatabases(newSelected);
  }

  function toggleCollectionSelection(database: string, collection: string) {
    setSelectedCollections((prev) => {
      const dbCollections = prev[database] || new Set();
      const newCollections = new Set(dbCollections);
      if (newCollections.has(collection)) {
        newCollections.delete(collection);
      } else {
        newCollections.add(collection);
      }
      return { ...prev, [database]: newCollections };
    });
  }

  function selectAllCollectionsForDatabase(database: string) {
    const collections = collectionsPerDb[database] || [];
    setSelectedCollections((prev) => ({
      ...prev,
      [database]: new Set(collections)
    }));
  }

  function clearAllCollectionsForDatabase(database: string) {
    setSelectedCollections((prev) => ({
      ...prev,
      [database]: new Set()
    }));
  }

  function handleSave() {
    // Guardar las selecciones de DBs y colecciones en settings_json
    const updatedSettings = {
      ...settings,
      selectedDatabases: Array.from(selectedDatabases),
      selectedCollections: Object.fromEntries(
        Object.entries(selectedCollections).map(([db, collections]) => [db, Array.from(collections)])
      )
    };
    
    const updatedForm = {
      ...props.form,
      settings_json: stringifySettings(updatedSettings)
    };

    setSubmitMode("save");
    setTouchedFields(markFields(saveValidation));
    if (Object.keys(saveValidation).length > 0) return;
    
    // Pasar el formulario actualizado a onSave
    props.onSave(updatedForm);
  }

  function handleTest() {
    setSubmitMode("test");
    setTouchedFields(markFields(testValidation));
    if (Object.keys(testValidation).length > 0) return;
    props.onTest();
  }

  function handleValidate() {
    setSubmitMode("save");
    setTouchedFields(markFields(saveValidation));
    const errors = saveValidation;
    if (Object.keys(errors).length === 0) {
      props.onValidate("Validación correcta.", true);
    } else {
      const message = Object.values(errors).join("; ");
      props.onValidate("Faltan campos: " + message, false);
    }
  }

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-x-hidden overflow-y-auto bg-black/45 p-4 backdrop-blur-sm sm:p-6">
      <div className="mx-auto flex min-h-full max-w-[940px] items-center justify-center">
        <div className={cn("w-full overflow-hidden rounded-lg shadow-[0_24px_80px_rgba(0,0,0,.72)]", surface)}>
          <header className={cn("flex h-12 items-center border-b px-5", panel, sectionBorder)}>
            <span className="mr-3 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: provider.color }} />
            <Input
              className="h-8 flex-1 border-0 bg-transparent px-0 text-sm font-medium text-zinc-100 placeholder:text-zinc-500 focus:border-0 focus:ring-0"
              placeholder="Ingresa el nombre de tu conexión"
              value={props.form.name}
              onChange={(event) => update("name", event.target.value)}
              onBlur={() => touch("name")}
            />
            <Badge className="mr-4 border-zinc-700/70 bg-zinc-900/80 text-zinc-200">{provider.name}</Badge>
            <button type="button" onClick={() => props.onOpenChange(false)} className="text-zinc-400 transition hover:text-white" aria-label="Cerrar">
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="grid h-[min(560px,calc(100vh-96px))] min-h-0 grid-cols-[180px_1fr]">
            <aside className={cn("border-r", panel, sectionBorder)}>
              <div className={cn("border-b px-4 py-3 text-[10px] font-medium uppercase tracking-[.08em]", sectionBorder, mutedText)}>
                Tipo de base de datos
              </div>
              <div className="p-2.5">
                {props.plugins.map((plugin) => {
                  const isActive = plugin.id === props.form.plugin_id;
                  const isLocked = !!props.editing;
                  return (
                    <button
                      key={plugin.id}
                      type="button"
                      disabled={isLocked}
                      onClick={() => !isLocked && selectPlugin(plugin)}
                      className={cn(
                        "flex h-9 w-full items-center gap-3 rounded-md border border-transparent px-3 text-left text-sm font-medium text-zinc-400 transition-colors",
                        isActive && "border-zinc-700 bg-zinc-900 text-white",
                        isLocked && !isActive && "cursor-not-allowed opacity-35",
                        isLocked && isActive && "cursor-not-allowed",
                        !isLocked && "hover:border-zinc-700/70 hover:bg-zinc-900 hover:text-white"
                      )}
                    >
                      <span className="grid h-6 w-6 place-items-center rounded-md text-white" style={{ backgroundColor: getProviderUi(plugin.id, plugin.manifest).color }}>
                        <ProviderIcon providerId={plugin.id} className="h-3.5 w-3.5" />
                      </span>
                      <span className="truncate">{plugin.name}</span>
                    </button>
                  );
                })}
                <div className="my-4 flex items-center gap-3 text-[10px] font-medium uppercase tracking-[.08em] text-zinc-500">
                  <span className="h-px flex-1 bg-zinc-800" />
                  Plugins
                  <span className="h-px flex-1 bg-zinc-800" />
                </div>
                <div className="grid gap-2 text-xs text-zinc-500">
                  <div className="flex items-center gap-2">
                    <Plug className="h-3.5 w-3.5" />
                    {props.plugins.length} instalados
                  </div>
                </div>
              </div>
            </aside>

            <section className={cn("flex min-h-0 min-w-0 flex-col", panel)}>
              <nav className={cn("flex h-11 items-end border-b px-5", panel, sectionBorder)}>
                <div className="flex min-w-0 items-end gap-5">
                  {provider.tabs.map((tab) => (
                    <ModalTab
                      key={tab}
                      active={visibleTab === tab}
                      icon={getTabIcon(tab)}
                      label={TAB_LABELS[tab]}
                      onClick={() => setActiveTab(tab)}
                    />
                  ))}
                </div>
              </nav>

              <div className="modal-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 py-5">
                {visibleTab === "general" && (
                  <ProviderGeneralFields
                    form={props.form}
                    provider={provider}
                    settings={settings}
                    connectionString={connectionString}
                    validation={visibleValidation}
                    onConnectionStringChange={handleConnectionStringChange}
                    update={update}
                    updateSetting={updateSetting}
                    touch={touch}
                  />
                )}

                {visibleTab === "auth" && (
                  <ProviderAuthFields
                    form={props.form}
                    provider={provider}
                    settings={settings}
                    update={update}
                    updateSetting={updateSetting}
                  />
                )}

                {visibleTab === "advanced" && (
                  <ProviderAdvancedFields provider={provider} settings={settings} updateSetting={updateSetting} />
                )}

                {visibleTab === "databases" && (
                  <DatabaseCollectionSelector
                    form={props.form}
                    provider={provider}
                    loadedDatabases={loadedDatabases}
                    selectedDatabases={selectedDatabases}
                    collectionsPerDb={collectionsPerDb}
                    selectedCollections={selectedCollections}
                    dbsSource={dbsSource}
                    collectionsSource={collectionsSource}
                    loadingDatabases={loadingDatabases}
                    loadingCollections={loadingCollections}
                    collectionsError={collectionsError}
                    databaseLoadError={databaseLoadError}
                    activeDbTab={activeDbTab}
                    onLoadDatabases={loadDatabases}
                    onRefreshDatabase={loadCollectionsForDatabase}
                    onToggleDatabase={toggleDatabaseSelection}
                    onToggleCollection={toggleCollectionSelection}
                    onSelectAllCollections={selectAllCollectionsForDatabase}
                    onClearAllCollections={clearAllCollectionsForDatabase}
                    onActiveDbTabChange={setActiveDbTab}
                  />
                )}

                {visibleTab === "ssl" && (
                  <PostgresSslFields form={props.form} settings={settings} update={update} updateSetting={updateSetting} />
                )}

                {visibleTab === "ssh" && (
                  <SshFields settings={settings} updateSetting={updateSetting} />
                )}
              </div>

              <footer className={cn("flex h-auto min-h-[52px] flex-col gap-2 items-start justify-between border-t px-5 py-3", panel, sectionBorder)}>
                {props.status && (
                  <div className={cn(
                    "w-full rounded-md border p-3 text-xs font-medium flex items-start gap-2 max-h-24 overflow-y-auto",
                    props.statusOk
                      ? "border-green-900/50 bg-green-950/30 text-green-300"
                      : "border-red-900/50 bg-red-950/30 text-red-300"
                  )}>
                    {props.statusOk ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    )}
                    <span className="break-words">{props.status}</span>
                  </div>
                )}
                <div className="flex w-full items-center gap-3">
                  <Button onClick={handleTest} disabled={props.busy} className="h-9 border-zinc-700/70 bg-[#0a0a0a] text-zinc-300">
                    {props.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
                    Probar Conexión
                  </Button>
                  <Button onClick={handleValidate} disabled={props.busy} className="h-9 border-zinc-700/70 bg-[#0a0a0a] text-zinc-300">
                    Validar
                  </Button>
                  <div className="flex-1" />
                  <div className="flex gap-2">
                    <Button onClick={() => props.onOpenChange(false)} className="h-9 border-zinc-700/70 bg-[#0a0a0a] text-zinc-300">
                      Cancelar
                    </Button>
                    <Button variant="primary" onClick={handleSave} disabled={props.busy} className="h-9">
                      {props.busy && <Loader2 className="h-4 w-4 animate-spin" />}
                      Guardar
                    </Button>
                  </div>
                </div>
              </footer>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

type ConnectionUpdater = <K extends keyof ConnectionInput>(key: K, value: ConnectionInput[K]) => void;
type SettingUpdater = (key: string, value: unknown) => void;

function ProviderGeneralFields({
  form,
  provider,
  settings,
  connectionString,
  validation,
  onConnectionStringChange,
  update,
  updateSetting,
  touch
}: {
  form: ConnectionInput;
  provider: ProviderUi;
  settings: Record<string, unknown>;
  connectionString: string;
  validation: Record<string, string>;
  onConnectionStringChange: (value: string) => void;
  update: ConnectionUpdater;
  updateSetting: SettingUpdater;
  touch: (field: ValidationField) => void;
}) {
  if (provider.id === "redis") {
    return (
      <div className="mx-auto grid w-full max-w-190 gap-5">
        <FormSection title="Connection string" description="Pega una URL Redis para rellenar los campos automáticamente.">
          <ModalField label="Connection string" value={connectionString} onChange={onConnectionStringChange} onBlur={() => touch("connectionString")} placeholder={provider.connectionPlaceholder} error={validation.connectionString} />
        </FormSection>
        <FormSection title="Servidor">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
            <ModalField label="Host" value={form.host} onChange={(value) => update("host", value)} onBlur={() => touch("host")} placeholder="localhost" error={validation.host} />
            <ModalField label="Puerto" type="number" value={String(form.port ?? provider.defaultPort)} onChange={(value) => update("port", value ? Number(value) : null)} onBlur={() => touch("port")} error={validation.port} />
          </div>
        </FormSection>
      </div>
    );
  }

  if (provider.id === "mongodb") {
    return (
      <div className="mx-auto grid w-full max-w-190 gap-5">
        <FormSection title="Connection string" description="Pega una URI MongoDB o MongoDB Atlas para rellenar servidor y credenciales.">
          <ModalField label="Connection string" value={connectionString} onChange={onConnectionStringChange} onBlur={() => touch("connectionString")} placeholder={provider.connectionPlaceholder} error={validation.connectionString} />
        </FormSection>
        <FormSection title="Servidor">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
            <ModalField label="Host" value={form.host} onChange={(value) => update("host", value)} onBlur={() => touch("host")} placeholder="localhost" error={validation.host} />
            <ModalField label="Puerto" type="number" value={String(form.port ?? provider.defaultPort)} onChange={(value) => update("port", value ? Number(value) : null)} onBlur={() => touch("port")} error={validation.port} />
          </div>
        </FormSection>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-190 gap-5">
      {validation.name && <InlineError>{validation.name}</InlineError>}
      <FormSection title="Connection string" description="Pega una URL PostgreSQL para rellenar host, puerto y credenciales.">
        <ModalField label="Connection string" value={connectionString} onChange={onConnectionStringChange} onBlur={() => touch("connectionString")} placeholder={provider.connectionPlaceholder} error={validation.connectionString} />
      </FormSection>
      <FormSection title="Servidor">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
          <ModalField label="Host" value={form.host} onChange={(value) => update("host", value)} onBlur={() => touch("host")} placeholder="localhost" error={validation.host} />
          <ModalField label="Puerto" type="number" value={String(form.port ?? provider.defaultPort)} onChange={(value) => update("port", value ? Number(value) : null)} onBlur={() => touch("port")} error={validation.port} />
        </div>
      </FormSection>
      <FormSection title="Base de Datos">
        <ModalField label="Base de datos" value={form.database} onChange={(value) => update("database", value)} onBlur={() => touch("database")} placeholder="Nombre de la base de datos" error={validation.database} />
      </FormSection>
    </div>
  );
}

function ProviderAuthFields({
  form,
  provider,
  settings,
  update,
  updateSetting
}: {
  form: ConnectionInput;
  provider: ProviderUi;
  settings: Record<string, unknown>;
  update: ConnectionUpdater;
  updateSetting: SettingUpdater;
}) {
  if (provider.id === "redis") {
    return (
      <div className="mx-auto grid w-full max-w-190 gap-5">
        <FormSection title="Credenciales" description="Usuario opcional (Redis 6+ ACL). Contraseña opcional según configuración del servidor.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ModalField label="Usuario (opcional)" value={form.username} onChange={(value) => update("username", value)} placeholder="Ingresa el nombre de usuario" />
            <ModalField label="Contraseña (opcional)" type="password" value={form.password} onChange={(value) => update("password", value)} placeholder="Ingresa la contraseña" trailing={<Eye className="h-3.5 w-3.5" />} />
          </div>
        </FormSection>
      </div>
    );
  }

  if (provider.id === "mongodb") {
    return (
      <div className="mx-auto grid w-full max-w-190 gap-5">
        <FormSection title="Credenciales">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ModalField label="Usuario" value={form.username} onChange={(value) => update("username", value)} placeholder="Ingresa el nombre de usuario" />
            <ModalField label="Contraseña" type="password" value={form.password} onChange={(value) => update("password", value)} placeholder="Ingresa la contraseña" trailing={<Eye className="h-3.5 w-3.5" />} />
          </div>
        </FormSection>
        <FormSection title="Autenticación MongoDB">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ModalField label="Auth Source" value={String(settings.authSource ?? "admin")} onChange={(value) => updateSetting("authSource", value)} placeholder="admin" />
            <ModalSelect
              label="Auth Mechanism"
              value={String(settings.authMechanism ?? "SCRAM-SHA-256")}
              onChange={(value) => updateSetting("authMechanism", value)}
              options={["SCRAM-SHA-256", "SCRAM-SHA-1", "MONGODB-X509", "MONGODB-AWS"]}
            />
          </div>
        </FormSection>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-190 gap-5">
      <FormSection title="Credenciales">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ModalField label="Usuario" value={form.username} onChange={(value) => update("username", value)} placeholder="Ingresa el nombre de usuario" />
          <ModalField label="Contraseña" type="password" value={form.password} onChange={(value) => update("password", value)} placeholder="Ingresa la contraseña" trailing={<Eye className="h-3.5 w-3.5" />} />
        </div>
      </FormSection>
    </div>
  );
}

function ProviderAdvancedFields({ provider, settings, updateSetting }: { provider: ProviderUi; settings: Record<string, unknown>; updateSetting: SettingUpdater }) {
  if (provider.id !== "mongodb") {
    return (
      <div className="mx-auto grid w-full max-w-190 gap-5">
        <FormSection title="Avanzado">
          <p className={cn("text-sm", mutedText)}>Este provider no tiene opciones avanzadas en esta versión.</p>
        </FormSection>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-190 gap-5">
      <FormSection title="Driver settings" description="Opciones menos frecuentes del driver MongoDB.">
        <ModalField label="Replica Set" value={String(settings.replicaSet ?? "")} onChange={(value) => updateSetting("replicaSet", value)} placeholder="Replica set name (optional)" />
        <FormOptions>
          <ModalCheckbox label="Enable MongoDB Atlas Stable API v1 for cluster connections" checked={Boolean(settings.useAtlasStableAPI)} onChange={(checked) => updateSetting("useAtlasStableAPI", checked)} />
        </FormOptions>
      </FormSection>
    </div>
  );
}

function DatabaseCollectionSelector({
  form,
  provider,
  loadedDatabases,
  selectedDatabases,
  collectionsPerDb,
  selectedCollections,
  dbsSource,
  collectionsSource,
  loadingDatabases,
  loadingCollections,
  collectionsError,
  databaseLoadError,
  activeDbTab,
  onLoadDatabases,
  onRefreshDatabase,
  onToggleDatabase,
  onToggleCollection,
  onSelectAllCollections,
  onClearAllCollections,
  onActiveDbTabChange
}: {
  form: ConnectionInput;
  provider: ProviderUi;
  loadedDatabases: string[];
  selectedDatabases: Set<string>;
  collectionsPerDb: Record<string, string[]>;
  selectedCollections: Record<string, Set<string>>;
  dbsSource: Record<string, "saved" | "server">;
  collectionsSource: Record<string, "saved" | "server">;
  loadingDatabases: boolean;
  loadingCollections: Record<string, boolean>;
  collectionsError: Record<string, string>;
  databaseLoadError: string;
  activeDbTab: string;
  onLoadDatabases: () => void;
  onRefreshDatabase: (database: string) => void;
  onToggleDatabase: (database: string) => void;
  onToggleCollection: (database: string, collection: string) => void;
  onSelectAllCollections: (database: string) => void;
  onClearAllCollections: (database: string) => void;
  onActiveDbTabChange: (database: string) => void;
}) {
  const collectionLabel = provider.id === "postgresql" ? "tablas" : "colecciones";
  const collectionLabelCap = provider.id === "postgresql" ? "Tablas" : "Colecciones";

  return (
    <div className="mx-auto grid w-full max-w-190 gap-5">
      <FormSection
        title="Cargar Bases de Datos"
        description="Haz click en 'Cargar bases' para obtener todas las bases de datos disponibles en esta conexión."
      >
        <Button
          onClick={onLoadDatabases}
          disabled={loadingDatabases}
          className="w-fit border-zinc-700/70 bg-[#0a0a0a] text-zinc-300 hover:bg-zinc-900"
        >
          {loadingDatabases ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Database className="h-4 w-4 mr-2" />}
          {loadingDatabases ? "Cargando..." : "Cargar bases"}
        </Button>
        {databaseLoadError && (
          <p className="mt-2 rounded-md border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs text-red-200">
            {databaseLoadError}
          </p>
        )}
      </FormSection>

      {loadedDatabases.length > 0 && (
        <FormSection
          title="Seleccionar Bases de Datos"
          description={`Se encontraron ${loadedDatabases.length} base(s). Selecciona las que desees explorar.`}
        >
            <div className="grid gap-2 rounded-md border border-zinc-800/80 bg-[#0c0c0c] p-3">
              {loadedDatabases.map((database) => (
                <label key={database} className="flex items-center gap-2 justify-between">
                  <div className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedDatabases.has(database)}
                      onChange={() => onToggleDatabase(database)}
                      className="w-4 h-4 rounded border-zinc-600 bg-zinc-900 cursor-pointer"
                    />
                    <span className="text-sm text-zinc-300">{database}</span>
                    {(dbsSource[database] === "saved" || collectionsSource[database] === "saved") && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-zinc-700/80 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                        Cacheada
                      </span>
                    )}
                  </div>
                  <div>
                    <Button size="sm" variant="ghost" onClick={() => onRefreshDatabase(database)} className="h-7 px-2 text-xs border-zinc-700/70 bg-transparent text-zinc-300 hover:bg-zinc-800">Actualizar</Button>
                  </div>
                </label>
              ))}
            </div>
        </FormSection>
      )}

      {selectedDatabases.size > 0 && provider.id !== "redis" && (
        <FormSection title={`${collectionLabelCap} por Base de Datos`}>
          <div className="border border-zinc-800/80 rounded-md bg-[#0c0c0c] overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-zinc-800/80 overflow-x-auto px-3">
              {Array.from(selectedDatabases).map((database) => (
                <button
                  key={database}
                  onClick={() => onActiveDbTabChange(database)}
                  className={cn(
                    "px-4 py-2 text-sm border-b-2 border-transparent whitespace-nowrap transition-colors",
                    activeDbTab === database
                      ? "border-blue-500 text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  <span className="inline-flex items-center gap-2">
                    <span>{database}</span>
                    {collectionsSource[database] === "saved" && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-zinc-700/80 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                        Cacheada
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>

            {/* Tab Content */}
            {activeDbTab && (
              <div className="p-4">
                {loadingCollections[activeDbTab] ? (
                  <div className="flex items-center gap-2 text-zinc-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cargando {collectionLabel}...
                  </div>
                ) : collectionsError[activeDbTab] ? (
                  <p className="text-xs text-red-400">
                    {collectionsError[activeDbTab]}
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-medium text-zinc-400">
                        {(collectionsPerDb[activeDbTab] || []).length} {collectionLabel}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onSelectAllCollections(activeDbTab)}
                          className="h-7 px-2 text-xs border-zinc-700/70 bg-transparent text-zinc-300 hover:bg-zinc-800"
                        >
                          Seleccionar todas
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onClearAllCollections(activeDbTab)}
                          className="h-7 px-2 text-xs border-zinc-700/70 bg-transparent text-zinc-300 hover:bg-zinc-800"
                        >
                          Limpiar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onRefreshDatabase(activeDbTab)}
                          title={`Actualizar ${collectionLabel} desde el servidor`}
                          className="h-7 px-2 text-xs border-zinc-700/70 bg-transparent text-zinc-300 hover:bg-zinc-800"
                        >
                          Actualizar
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-2 max-h-64 overflow-y-auto rounded border border-zinc-800/50 bg-zinc-950/30 p-2">
                      {(collectionsPerDb[activeDbTab] || []).length === 0 ? (
                        <p className="text-xs text-zinc-500 text-center py-4">
                          No hay {collectionLabel} disponibles
                        </p>
                      ) : (
                        (collectionsPerDb[activeDbTab] || []).map((collection) => (
                          <label key={collection} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-zinc-900 rounded">
                            <input
                              type="checkbox"
                              checked={selectedCollections[activeDbTab]?.has(collection) ?? false}
                              onChange={() => onToggleCollection(activeDbTab, collection)}
                              className="w-4 h-4 rounded border-zinc-600 bg-zinc-900 cursor-pointer"
                            />
                            <span className="text-sm text-zinc-300">{collection}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </FormSection>
      )}

      {selectedDatabases.size === 0 && loadedDatabases.length > 0 && provider.id !== "redis" && (
        <FormSection title="Resumen" description={`Selecciona al menos una base de datos para ver sus ${collectionLabel}.`}>
          <div className="text-sm text-zinc-400">
            Bases de datos disponibles: {loadedDatabases.length}
          </div>
        </FormSection>
      )}
    </div>
  );
}


function PostgresSslFields({ form, settings, update, updateSetting }: { form: ConnectionInput; settings: Record<string, unknown>; update: ConnectionUpdater; updateSetting: SettingUpdater }) {
  return (
    <div className="mx-auto grid w-full max-w-190 gap-5">
      <FormSection title="Modo SSL" description="Configura cómo debe negociar PostgreSQL una conexión cifrada.">
        <ModalSelect
          label="Modo SSL"
          value={form.ssl_mode || "prefer"}
          onChange={(value) => update("ssl_mode", value)}
          options={[
            { value: "disable", label: "Deshabilitado" },
            { value: "prefer", label: "Preferido" },
            { value: "require", label: "Requerido" },
            { value: "verify-ca", label: "Verificar CA" },
            { value: "verify-full", label: "Verificar completo" }
          ]}
        />
      </FormSection>
      <FormSection title="Certificados" description="Rutas opcionales para entornos que requieren certificados locales.">
        <div className="grid gap-3">
          <ModalField label="CA Path" value={String(settings.sslCa ?? "")} onChange={(value) => updateSetting("sslCa", value)} placeholder="/path/to/ca.pem" />
          <ModalField label="Client Cert Path" value={String(settings.sslCert ?? "")} onChange={(value) => updateSetting("sslCert", value)} placeholder="/path/to/client.pem" />
          <ModalField label="Client Key Path" value={String(settings.sslKey ?? "")} onChange={(value) => updateSetting("sslKey", value)} placeholder="/path/to/client-key.pem" />
        </div>
      </FormSection>
    </div>
  );
}

function SshFields({ settings, updateSetting }: { settings: Record<string, unknown>; updateSetting: SettingUpdater }) {
  const mode = String(settings.sshMode ?? "existing");
  const enabled = Boolean(settings.sshEnabled);

  return (
    <div className="mx-auto grid w-full max-w-190 gap-5">
      <FormSection title="Túnel SSH" description="Guarda la configuración del túnel para usarla cuando el backend de conexión la ejecute.">
        <FormOptions>
          <ModalCheckbox label="Usar Túnel SSH" checked={enabled} onChange={(checked) => updateSetting("sshEnabled", checked)} />
        </FormOptions>
        <SegmentedControl
          value={mode}
          options={[
            { value: "existing", label: "Usar Conexión SSH Existente" },
            { value: "inline", label: "Configurar SSH en Línea" }
          ]}
          onChange={(value) => updateSetting("sshMode", value)}
        />
      </FormSection>
      {mode === "existing" ? (
        <FormSection title="Conexión existente">
          <ModalSelect label="Seleccionar conexión SSH" value={String(settings.sshConnectionId ?? "")} onChange={(value) => updateSetting("sshConnectionId", value)} options={[{ value: "", label: "No hay conexiones SSH disponibles" }]} />
        </FormSection>
      ) : (
        <FormSection title="SSH en línea">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
            <ModalField label="Host SSH" value={String(settings.sshHost ?? "")} onChange={(value) => updateSetting("sshHost", value)} placeholder="ssh.example.com" />
            <ModalField label="Puerto SSH" type="number" value={String(settings.sshPort ?? 22)} onChange={(value) => updateSetting("sshPort", Number(value || 22))} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ModalField label="Usuario SSH" value={String(settings.sshUser ?? "")} onChange={(value) => updateSetting("sshUser", value)} placeholder="user" />
            <ModalField label="Contraseña SSH" type="password" value={String(settings.sshPassword ?? "")} onChange={(value) => updateSetting("sshPassword", value)} placeholder="Ingresa la contraseña SSH" />
          </div>
          <ModalField label="Archivo de clave SSH (opcional)" value={String(settings.sshKeyPath ?? "")} onChange={(value) => updateSetting("sshKeyPath", value)} placeholder="/ruta/a/id_rsa" />
          <ModalField label="Frase de paso de clave SSH (opcional)" type="password" value={String(settings.sshPassphrase ?? "")} onChange={(value) => updateSetting("sshPassphrase", value)} placeholder="Ingresa la frase de paso si la clave está cifrada" trailing={<Eye className="h-3.5 w-3.5" />} />
        </FormSection>
      )}
    </div>
  );
}

function FormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[.12em] text-zinc-200">{title}</h3>
        {description && <p className={cn("mt-1 max-w-2xl text-xs leading-5", softText)}>{description}</p>}
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function FormOptions({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-2 rounded-md border border-zinc-800/80 bg-[#0c0c0c] px-3 py-2.5">
      {children}
    </div>
  );
}

function ModalTab({ active, icon, label, onClick }: { active?: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative inline-flex h-11 max-w-65 items-center gap-1.5 truncate border-b-2 border-transparent px-0 text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-200",
        active && "border-blue-500 text-white"
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function ModalField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  readOnly,
  trailing,
  error,
  onBlur
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  type?: string;
  placeholder?: string;
  readOnly?: boolean;
  trailing?: React.ReactNode;
  error?: string;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const isPasswordField = type === "password";
  const displayType = showPassword && isPasswordField ? "text" : type;

  return (
    <label className={cn("grid gap-1.5 text-[10px] font-medium uppercase tracking-[.08em]", mutedText)}>
      {label}
      <span className="relative">
        <Input
          type={displayType}
          readOnly={readOnly}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange?.(event.target.value)}
          onBlur={onBlur}
          className={cn(
            "h-9 border-zinc-700/70 bg-[#0a0a0a] px-3 text-[13px] font-medium text-zinc-100 placeholder:font-normal placeholder:italic placeholder:text-zinc-500",
            (isPasswordField || trailing) && "pr-11",
            readOnly && "text-zinc-400",
            error && "border-red-900 focus:border-red-700 focus:ring-red-900/20"
          )}
        />
        {isPasswordField ? (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        ) : (
          trailing && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500">{trailing}</span>
        )}
      </span>
      {error && <span className="text-xs normal-case tracking-normal text-red-400">{error}</span>}
    </label>
  );
}

function InlineError({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs text-red-200">{children}</p>;
}

function ModalSelect({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: Array<string | { value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className={cn("grid gap-1.5 text-[10px] font-medium uppercase tracking-[.08em]", mutedText)}>
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-zinc-700/70 bg-[#0a0a0a] px-3 text-[13px] font-medium text-zinc-100 outline-none transition-colors hover:border-zinc-600 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/20"
      >
        {options.map((option) => {
          const item = typeof option === "string" ? { value: option, label: option } : option;
          return (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
          );
        })}
      </select>
    </label>
  );
}

function ModalCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={cn("flex items-center gap-2 text-xs", mutedText)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 rounded border-zinc-600 bg-[#0a0a0a] accent-white"
      />
      {label}
    </label>
  );
}

function SegmentedControl({ value, options, onChange }: { value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <div className="inline-flex max-w-full overflow-hidden rounded-md border border-zinc-700/70 bg-[#0a0a0a]">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "h-8 px-3 text-xs font-medium text-zinc-400 transition hover:text-zinc-100",
            value === option.value && "bg-white text-black hover:text-black"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function getProviderUi(pluginId: string, manifest?: PluginManifest): ProviderUi {
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

function ProviderIcon({ providerId, className }: { providerId: string; className?: string }) {
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

function getTabIcon(tab: ModalTabId) {
  if (tab === "auth") return <KeyRound className="h-3.5 w-3.5" />;
  if (tab === "advanced") return <Settings className="h-3.5 w-3.5" />;
  if (tab === "ssl") return <Shield className="h-3.5 w-3.5" />;
  if (tab === "ssh") return <KeyRound className="h-3.5 w-3.5" />;
  if (tab === "databases") return <Network className="h-3.5 w-3.5" />;
  return <Database className="h-3.5 w-3.5" />;
}

function buildConnectionString(form: ConnectionInput, provider: ProviderUi) {
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

type ParseConnectionStringResult =
  | {
      ok: true;
      input: Partial<ConnectionInput>;
      settings: Record<string, unknown>;
    }
  | {
      ok: false;
      error: string;
    };

function parseConnectionString(value: string, provider: ProviderUi): ParseConnectionStringResult {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "Connection string inválido." };
  }

  const scheme = url.protocol.replace(":", "");
  if (!provider.connectionSchemes.includes(scheme)) {
    return {
      ok: false,
      error: `El esquema "${scheme}" no corresponde a ${provider.name}.`
    };
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

function validateConnection(form: ConnectionInput, provider: ProviderUi, connectionStringError: string, mode: ValidationMode) {
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

function filterVisibleValidation(
  errors: Record<string, string>,
  touchedFields: Partial<Record<ValidationField, boolean>>,
  submitMode: ValidationMode | null
) {
  if (submitMode) return errors;
  return Object.fromEntries(
    Object.entries(errors).filter(([field]) => Boolean(touchedFields[field as ValidationField]))
  );
}

function markFields(errors: Record<string, string>) {
  return Object.fromEntries(Object.keys(errors).map((field) => [field, true])) as Partial<Record<ValidationField, boolean>>;
}

function getNextProviderDatabase(pluginId: string, currentDatabase: string) {
  if (pluginId !== "redis") return currentDatabase;
  const databaseIndex = Number(currentDatabase);
  return Number.isInteger(databaseIndex) && databaseIndex >= 0 ? String(databaseIndex) : "0";
}

function getDatabaseOptions(provider: ProviderUi, form: ConnectionInput, settings: Record<string, unknown>) {
  const discovered = Array.isArray(settings.databaseOptions)
    ? settings.databaseOptions.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  const defaults =
    provider.id === "redis"
      ? Array.from({ length: 16 }, (_, index) => String(index))
      : provider.id === "postgresql"
        ? ["postgres", "template1", "template0"]
        : provider.id === "mongodb"
          ? ["admin", "local", "config"]
          : [];

  return Array.from(new Set([form.database, ...discovered, ...defaults].filter((value) => String(value).trim().length > 0).map(String)));
}
