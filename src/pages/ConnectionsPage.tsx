
import { invoke } from "@tauri-apps/api/core";
import {
  CheckCircle2,
  Copy,
  Database,
  Eye,
  EyeOff,
  Grid2X2,
  KeyRound,
  List,
  Loader2,
  ExternalLink,
  LogOut,
  LogIn,
  Network,
  Pencil,
  Plug,
  Plus,
  Search,
  Settings,
  Shield,
  Trash2,
  X,
  XCircle,
  Zap
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useNavigate } from "@/lib/router-compat";
import { useEffect, useMemo, useState } from "react";
import { useSessionsStore, sessionRoute } from "@/store/sessions";
import { IconButton } from "@/components/icon-button";
import { Modal } from "@/components/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import {
  buildConnectionString,
  emptyConnection,
  filterVisibleValidation,
  getNextProviderDatabase,
  getProviderUi,
  getProviderViewType,
  markFields,
  parseConnectionString,
  parseSettings,
  ProviderIcon,
  stringifySettings,
  TAB_LABELS,
  validateConnection,
  withoutConnectionStringState
} from "@/lib/providers";
import { hoverSurface, mutedText, panel, sectionBorder, softText, surface } from "@/lib/styles";
import type {
  Connection,
  ConnectionGroup,
  ConnectionInput,
  ConnectionUpdater,
  ModalTabId,
  PluginInfo,
  ProviderUi,
  SettingUpdater,
  ValidationField,
  ValidationMode
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { passphraseStatus } from "@/lib/auth";
import { triggerSync } from "@/lib/sync";
import { useDebounced } from "@/lib/use-debounce";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Folder, FolderPlus, FolderOpen, GripVertical, Inbox, Layers, MoreHorizontal } from "lucide-react";

type CredentialView = {
  id: number;
  name: string;
  username: string;
  created_at: string;
  updated_at: string;
};

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [groups, setGroups] = useState<ConnectionGroup[]>([]);
  const [credentials, setCredentials] = useState<CredentialView[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<number | null | "__all__">("__all__");
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [form, setForm] = useState<ConnectionInput>(emptyConnection);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [statusOk, setStatusOk] = useState<boolean>(false);

  async function refresh() {
    const [nextConnections, nextPlugins, nextGroups] = await Promise.all([
      invoke<Connection[]>("list_connections"),
      invoke<PluginInfo[]>("list_plugins"),
      invoke<ConnectionGroup[]>("list_groups"),
    ]);
    setConnections(nextConnections);
    setPlugins(nextPlugins);
    setGroups(nextGroups);
    try {
      const creds = await invoke<CredentialView[]>("list_credentials_view");
      setCredentials(creds);
    } catch {
      setCredentials([]);
    }
  }

  async function createFolder(name: string) {
    if (!name.trim()) return;
    await invoke("create_group", { name: name.trim(), parentId: null });
    await refresh();
    triggerSync();
  }

  async function renameFolder(id: number, name: string) {
    await invoke("update_group", { id, name });
    await refresh();
    triggerSync();
  }

  async function deleteFolder(id: number) {
    await invoke("delete_group", { id, reassignTo: null });
    if (activeGroupId === id) setActiveGroupId("__all__");
    await refresh();
    triggerSync();
  }

  async function reorderInGroup(ids: number[]) {
    await invoke("reorder_connections", { ids });
    await refresh();
    triggerSync();
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
  const debouncedQuery = useDebounced(query, 180);
  const visibleConnections = connections.filter((connection) => {
    if (activeGroupId !== "__all__") {
      const gid = connection.group_id ?? null;
      if (gid !== activeGroupId) return false;
    }
    const text = `${connection.name} ${connection.plugin_id} ${connection.host} ${connection.database}`.toLowerCase();
    return text.includes(debouncedQuery.toLowerCase());
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
      enabled: connection.enabled,
      credential_id: connection.credential_id ?? null
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
      triggerSync();
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
    triggerSync();
  }

  async function duplicateConnection(connection: Connection) {
    const { id: _id, position: _pos, created_at: _created, updated_at: _updated, ...input } = connection;
    await invoke("create_connection", { input: { ...input, name: `${connection.name} copia` } });
    await refresh();
    triggerSync();
  }

  const migrationCandidates = useMemo(
    () => connections.filter((c) => c.password && c.password.length > 0 && (c.credential_id === null || c.credential_id === undefined)),
    [connections],
  );

  async function migrateAllToCredentials() {
    setBusy(true);
    setStatus("");
    try {
      const ps = await passphraseStatus();
      if (!ps.configured) {
        throw new Error("Configura la passphrase en Ajustes → Mi cuenta antes de migrar.");
      }
      if (!ps.unlocked) {
        throw new Error("Desbloquea el vault en Ajustes → Mi cuenta antes de migrar.");
      }
      for (const c of migrationCandidates) {
        const cred = await invoke<{ id: number }>("create_credential", {
          name: `${c.name} (auto)`,
          username: c.username,
          password: c.password,
        });
        await invoke("attach_credential_to_connection", {
          connectionId: c.id,
          credentialId: cred.id,
        });
      }
      await refresh();
      triggerSync();
      setStatus(`${migrationCandidates.length} migradas.`);
      setStatusOk(true);
    } catch (e) {
      setStatus(String(e));
      setStatusOk(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ConnectionsView
        connections={visibleConnections}
        allConnections={connections}
        total={connections.length}
        query={query}
        setQuery={setQuery}
        pluginMap={pluginMap}
        groups={groups}
        activeGroupId={activeGroupId}
        setActiveGroupId={setActiveGroupId}
        migrationCount={migrationCandidates.length}
        onMigrateAll={migrateAllToCredentials}
        migrationBusy={busy}
        onCreate={openCreate}
        onEdit={openEdit}
        onDelete={deleteConnection}
        onDuplicate={duplicateConnection}
        onTest={testConnection}
        onCreateFolder={createFolder}
        onRenameFolder={renameFolder}
        onDeleteFolder={deleteFolder}
        onReorder={reorderInGroup}
      />

      <ConnectionDialog
        open={dialogOpen}
        form={form}
        plugins={enabledPlugins}
        groups={groups}
        credentials={credentials}
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
    </>
  );
}

function ConnectionsView(props: {
  connections: Connection[];
  allConnections: Connection[];
  total: number;
  query: string;
  setQuery: (query: string) => void;
  pluginMap: Map<string, PluginInfo>;
  groups: ConnectionGroup[];
  activeGroupId: number | null | "__all__";
  setActiveGroupId: (id: number | null | "__all__") => void;
  migrationCount: number;
  migrationBusy: boolean;
  onMigrateAll: () => Promise<void>;
  onCreate: () => void;
  onEdit: (connection: Connection) => void;
  onDelete: (id: number) => void;
  onDuplicate: (connection: Connection) => void;
  onTest: (connection: Connection) => void;
  onCreateFolder: (name: string) => Promise<void>;
  onRenameFolder: (id: number, name: string) => Promise<void>;
  onDeleteFolder: (id: number) => Promise<void>;
  onReorder: (ids: number[]) => Promise<void>;
}) {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const navigate = useNavigate();
  const { sessions, addSession, removeSession } = useSessionsStore();
  const [testResults, setTestResults] = useState<Record<number, { ms: number | null; loading: boolean; ok: boolean }>>({});
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [deletingFolder, setDeletingFolder] = useState<ConnectionGroup | null>(null);
  const [deletingConnection, setDeletingConnection] = useState<Connection | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const dndDisabled = props.activeGroupId === "__all__";
  const orderedIds = useMemo(() => props.connections.map((c) => c.id), [props.connections]);
  const { countByGroup, countNoGroup } = useMemo(() => {
    const byGroup = new Map<number, number>();
    let noGroup = 0;
    for (const c of props.allConnections) {
      if (c.group_id == null) noGroup += 1;
      else byGroup.set(c.group_id, (byGroup.get(c.group_id) ?? 0) + 1);
    }
    return { countByGroup: byGroup, countNoGroup: noGroup };
  }, [props.allConnections]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIdx = orderedIds.indexOf(Number(active.id));
    const toIdx = orderedIds.indexOf(Number(over.id));
    if (fromIdx < 0 || toIdx < 0) return;
    const newOrder = arrayMove(orderedIds, fromIdx, toIdx);
    props.onReorder(newOrder).catch(() => undefined);
  }

  function connectTo(connection: Connection) {
    const existing = sessions[connection.id];
    addSession(connection);
    if (existing) {
      navigate(sessionRoute(existing));
    } else {
      navigate(`/connections/${getProviderViewType(connection.plugin_id)}?id=${connection.id}`);
    }
  }

  async function testInline(connection: Connection) {
    setTestResults((prev) => ({ ...prev, [connection.id]: { ms: null, loading: true, ok: false } }));
    const start = Date.now();
    try {
      await invoke("test_connection", { input: connection });
      setTestResults((prev) => ({ ...prev, [connection.id]: { ms: Date.now() - start, loading: false, ok: true } }));
    } catch {
      setTestResults((prev) => ({ ...prev, [connection.id]: { ms: null, loading: false, ok: false } }));
    }
  }

  return (
    <div className={cn("flex min-w-0 flex-1 flex-col", panel)}>
      <header className={cn("flex h-14 items-center justify-between border-b px-6", panel, sectionBorder)}>
        <div className="flex items-baseline gap-3">
          <h1 className="text-base font-semibold tracking-[-0.01em] text-white">Conexiones</h1>
          <span className={cn("text-xs", mutedText)}>{props.total} conexiones</span>
        </div>
        <Button variant="primary" onClick={props.onCreate} className="shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 transition-all">
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

      {props.migrationCount > 0 && (
        <div className={cn("flex items-center gap-3 border-b border-amber-900/40 bg-amber-950/30 px-5 py-2 text-xs text-amber-200", panel)}>
          <span>
            {props.migrationCount} conexion{props.migrationCount === 1 ? "" : "es"} con contraseña en texto plano. Mígra a credenciales cifradas.
          </span>
          <button
            disabled={props.migrationBusy}
            onClick={() => props.onMigrateAll()}
            className="ml-auto rounded border border-amber-700 bg-amber-900/40 px-2 py-0.5 text-[11px] font-medium text-amber-100 hover:bg-amber-900/70 disabled:opacity-50"
          >
            {props.migrationBusy ? "Migrando…" : "Migrar todas"}
          </button>
        </div>
      )}

      <FolderBar
        groups={props.groups}
        activeGroupId={props.activeGroupId}
        setActiveGroupId={props.setActiveGroupId}
        countAll={props.total}
        countByGroup={countByGroup}
        countNoGroup={countNoGroup}
        onCreate={props.onCreateFolder}
        onRename={props.onRenameFolder}
        onDelete={(g) => setDeletingFolder(g)}
        creatingFolder={creatingFolder}
        setCreatingFolder={setCreatingFolder}
        newFolderName={newFolderName}
        setNewFolderName={setNewFolderName}
        dndDisabled={dndDisabled}
      />

      {viewMode === "grid" && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedIds} strategy={rectSortingStrategy}>
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 content-start gap-3 overflow-x-hidden overflow-y-auto p-5 lg:grid-cols-2 xl:grid-cols-3">
          {props.connections.length === 0 && (
            <div className={cn("col-span-full flex min-h-64 flex-col items-center justify-center rounded-xl p-8 text-center border-2 border-dashed border-zinc-800/60 bg-zinc-900/20 backdrop-blur-sm")}>
              <div className="grid h-12 w-12 place-items-center rounded-xl border border-white/5 bg-white/5 text-zinc-400 shadow-inner">
                <Database className="h-6 w-6" />
              </div>
              <h2 className="mt-5 text-sm font-semibold text-zinc-200">No hay conexiones</h2>
              <p className={cn("mt-2 max-w-sm text-xs", mutedText)}>Crea una conexión local para PostgreSQL, MongoDB o Redis.</p>
            </div>
          )}
          {props.connections.map((connection) => {
            const plugin = props.pluginMap.get(connection.plugin_id);
            return (
              <SortableArticle key={connection.id} id={connection.id} disabled={dndDisabled} className={cn("rounded-xl p-5", surface, hoverSurface)}>
                <div className="flex gap-4">
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-white/10 shadow-inner">
                    <ProviderIcon providerId={connection.plugin_id} className="block h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-semibold text-zinc-100">{connection.name}</h3>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset" style={{ color: getProviderUi(connection.plugin_id, plugin?.manifest).color, backgroundColor: `${getProviderUi(connection.plugin_id, plugin?.manifest).color}15`, borderColor: `${getProviderUi(connection.plugin_id, plugin?.manifest).color}30` }}>{plugin?.name ?? connection.plugin_id}</span>
                    </div>
                    <p className={cn("mt-3 truncate text-xs font-mono", softText)}>
                      {connection.host}:{connection.port ?? "-"}
                    </p>
                  </div>
                </div>
                {(() => {
                  const providerColor = getProviderUi(connection.plugin_id, plugin?.manifest).color;
                  const isOpen = Boolean(sessions[connection.id]);
                  if (!isOpen) {
                    return (
                      <button
                        onClick={() => connectTo(connection)}
                        className="mt-5 flex w-full items-center justify-center rounded-md px-3 py-1.5 text-xs font-semibold transition-all"
                        style={{ color: "#fff", backgroundColor: providerColor, border: `1px solid ${providerColor}`, boxShadow: `0 4px 14px ${providerColor}40` }}
                      >
                        Conectar
                      </button>
                    );
                  }
                  return (
                    <div className="mt-5 flex gap-2">
                      <button
                        onClick={() => connectTo(connection)}
                        className="flex flex-1 items-center justify-center rounded-md px-3 py-1.5 text-xs font-semibold transition-all"
                        style={{ color: "#fff", backgroundColor: providerColor, border: `1px solid ${providerColor}`, boxShadow: `0 4px 14px ${providerColor}40` }}
                      >
                        Abrir
                      </button>
                      <button
                        onClick={() => removeSession(connection.id)}
                        className="flex flex-1 items-center justify-center rounded-md px-3 py-1.5 text-xs font-semibold transition-all bg-white text-zinc-900 hover:bg-zinc-100"
                      >
                        Cerrar
                      </button>
                    </div>
                  );
                })()}
                <div className="mt-2 flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5">
                    {(() => {
                      const tr = testResults[connection.id];
                      if (!tr) return null;
                      if (tr.loading) return <span className="text-[10px] text-zinc-500">Probando...</span>;
                      if (tr.ok) return <span className="text-[10px] font-mono text-emerald-400">{tr.ms}ms</span>;
                      return <span className="text-[10px] text-red-400">Sin conexión</span>;
                    })()}
                  </div>
                  <div className="flex gap-1 text-zinc-500">
                    <Button variant="ghost" size="icon" title="Probar conexión" onClick={() => testInline(connection)} disabled={testResults[connection.id]?.loading}>
                      {testResults[connection.id]?.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" title="Editar" onClick={() => props.onEdit(connection)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" title="Duplicar" onClick={() => props.onDuplicate(connection)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" title="Eliminar" onClick={() => setDeletingConnection(connection)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </SortableArticle>
            );
          })}
        </div>
        </SortableContext>
        </DndContext>
      )}

      {viewMode === "list" && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto p-5">
          {props.connections.length === 0 && (
            <div className={cn("flex min-h-64 flex-col items-center justify-center rounded-xl p-8 text-center border-2 border-dashed border-zinc-800/60 bg-zinc-900/20 backdrop-blur-sm")}>
              <div className="grid h-12 w-12 place-items-center rounded-xl border border-white/5 bg-white/5 text-zinc-400 shadow-inner">
                <Database className="h-6 w-6" />
              </div>
              <h2 className="mt-5 text-sm font-semibold text-zinc-200">No hay conexiones</h2>
              <p className={cn("mt-2 max-w-sm text-xs", mutedText)}>Crea una conexión local para PostgreSQL, MongoDB o Redis.</p>
            </div>
          )}
          {props.connections.map((connection) => {
            const plugin = props.pluginMap.get(connection.plugin_id);
            return (
              <SortableRow key={connection.id} id={connection.id} disabled={dndDisabled} className={cn("flex items-center gap-4 rounded-xl px-4 py-3", surface, hoverSurface)}>
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-white/10 shadow-inner">
                  <ProviderIcon providerId={connection.plugin_id} className="block h-full w-full object-cover" />
                </div>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-100">{connection.name}</span>
                <span className="shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset" style={{ color: getProviderUi(connection.plugin_id, plugin?.manifest).color, backgroundColor: `${getProviderUi(connection.plugin_id, plugin?.manifest).color}15`, borderColor: `${getProviderUi(connection.plugin_id, plugin?.manifest).color}30` }}>{plugin?.name ?? connection.plugin_id}</span>
                <span className={cn("shrink-0 text-xs font-mono w-32 truncate text-right", softText)}>{connection.host}:{connection.port ?? "-"}</span>
                <div className="flex shrink-0 items-center gap-1 text-zinc-500">
                  {(() => {
                    const tr = testResults[connection.id];
                    if (!tr) return null;
                    if (tr.loading) return <span className="text-[10px] text-zinc-500">...</span>;
                    if (tr.ok) return <span className="text-[10px] font-mono text-emerald-400">{tr.ms}ms</span>;
                    return <span className="text-[10px] text-red-400">Error</span>;
                  })()}
                  <Button variant="ghost" size="icon" title={sessions[connection.id] ? "Abrir" : "Conectar"} className="text-blue-400 hover:text-blue-300" onClick={() => connectTo(connection)}>
                    {sessions[connection.id] ? <ExternalLink className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" title="Probar conexión" onClick={() => testInline(connection)} disabled={testResults[connection.id]?.loading}>
                    {testResults[connection.id]?.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" title="Editar" onClick={() => props.onEdit(connection)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Duplicar" onClick={() => props.onDuplicate(connection)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Eliminar" onClick={() => setDeletingConnection(connection)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </SortableRow>
            );
          })}
        </div>
        </SortableContext>
        </DndContext>
      )}

      {deletingFolder && (
        <Modal onClose={() => setDeletingFolder(null)}>
          <div className="w-full max-w-md rounded-md border border-zinc-800 bg-zinc-950 p-5 shadow-xl">
            <h2 className="text-sm font-medium text-zinc-100">¿Eliminar carpeta?</h2>
            <p className="mt-2 break-all rounded bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-300">{deletingFolder.name}</p>
            <p className="mt-2 text-xs text-zinc-400">Las conexiones dentro se moverán a "Sin carpeta".</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDeletingFolder(null)}>Cancelar</Button>
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  await props.onDeleteFolder(deletingFolder.id);
                  setDeletingFolder(null);
                }}
              >
                Eliminar
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {deletingConnection && (
        <Modal onClose={() => setDeletingConnection(null)}>
          <div className="w-full max-w-md rounded-md border border-zinc-800 bg-zinc-950 p-5 shadow-xl">
            <h2 className="text-sm font-medium text-zinc-100">¿Eliminar conexión?</h2>
            <p className="mt-2 break-all rounded bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-300">
              {deletingConnection.name} · {deletingConnection.host}:{deletingConnection.port ?? "-"}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDeletingConnection(null)}>Cancelar</Button>
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  await props.onDelete(deletingConnection.id);
                  setDeletingConnection(null);
                }}
              >
                Eliminar
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SortableArticle({ id, disabled, className, children }: { id: number; disabled?: boolean; className?: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
    boxShadow: isDragging ? "0 24px 60px rgba(0,0,0,.55)" : undefined,
  };
  return (
    <article ref={setNodeRef} style={style} className={cn("group relative", className, isDragging && "ring-2 ring-blue-500/60")}>
      {!disabled && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label="Arrastrar"
          title="Arrastrar para reordenar"
          className="absolute left-1 top-1/2 z-10 -translate-y-1/2 rounded-md p-1 text-zinc-600 opacity-40 transition-opacity hover:bg-zinc-800/70 hover:text-zinc-200 hover:opacity-100 group-hover:opacity-80 cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      {children}
    </article>
  );
}

function SortableRow({ id, disabled, className, children }: { id: number; disabled?: boolean; className?: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
    boxShadow: isDragging ? "0 16px 40px rgba(0,0,0,.5)" : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className={cn("group", className, isDragging && "ring-2 ring-blue-500/60")}>
      {!disabled && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label="Arrastrar"
          title="Arrastrar para reordenar"
          className="cursor-grab text-zinc-600 hover:text-zinc-300 active:cursor-grabbing touch-none"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      {children}
    </div>
  );
}

function FolderBar({
  groups,
  activeGroupId,
  setActiveGroupId,
  countAll,
  countByGroup,
  countNoGroup,
  onCreate,
  onRename,
  onDelete,
  creatingFolder,
  setCreatingFolder,
  newFolderName,
  setNewFolderName,
  dndDisabled,
}: {
  groups: ConnectionGroup[];
  activeGroupId: number | null | "__all__";
  setActiveGroupId: (id: number | null | "__all__") => void;
  countAll: number;
  countByGroup: Map<number, number>;
  countNoGroup: number;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
  onDelete: (g: ConnectionGroup) => void;
  creatingFolder: boolean;
  setCreatingFolder: (v: boolean) => void;
  newFolderName: string;
  setNewFolderName: (v: string) => void;
  dndDisabled: boolean;
}) {
  return (
    <div className={cn("border-b px-5 py-2.5", panel, sectionBorder)}>
      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
        <FolderTab
          active={activeGroupId === "__all__"}
          icon={<Layers className="h-3.5 w-3.5" />}
          label="Todas"
          count={countAll}
          onClick={() => setActiveGroupId("__all__")}
        />
        <FolderTab
          active={activeGroupId === null}
          icon={<Inbox className="h-3.5 w-3.5" />}
          label="Sin carpeta"
          count={countNoGroup}
          onClick={() => setActiveGroupId(null)}
        />
        <span className="mx-1 h-5 w-px shrink-0 bg-zinc-800/70" />
        {groups.map((g) => (
          <FolderTab
            key={g.id}
            active={activeGroupId === g.id}
            icon={<Folder className="h-3.5 w-3.5" />}
            label={g.name}
            count={countByGroup.get(g.id) ?? 0}
            onClick={() => setActiveGroupId(g.id)}
            onRename={async () => {
              const next = window.prompt("Nuevo nombre", g.name);
              if (next && next.trim() && next.trim() !== g.name) await onRename(g.id, next.trim());
            }}
            onDelete={() => onDelete(g)}
          />
        ))}
        {creatingFolder ? (
          <div className="flex items-center gap-1">
            <Input
              autoFocus
              className="h-8 w-44 text-xs"
              placeholder="Nombre de la carpeta…"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter") {
                  await onCreate(newFolderName);
                  setNewFolderName("");
                  setCreatingFolder(false);
                }
                if (e.key === "Escape") {
                  setNewFolderName("");
                  setCreatingFolder(false);
                }
              }}
              onBlur={async () => {
                if (newFolderName.trim()) await onCreate(newFolderName);
                setNewFolderName("");
                setCreatingFolder(false);
              }}
            />
          </div>
        ) : (
          <button
            onClick={() => setCreatingFolder(true)}
            className="ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-dashed border-zinc-700/60 px-2.5 text-[11px] text-zinc-400 transition-colors hover:border-zinc-500 hover:bg-zinc-900/60 hover:text-zinc-200"
            title="Crear carpeta"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Nueva carpeta
          </button>
        )}
      </div>
      {dndDisabled && activeGroupId === "__all__" && (
        <p className="mt-2 text-[10.5px] text-zinc-500">
          <GripVertical className="mr-0.5 inline h-3 w-3 -translate-y-px" />
          Filtra por carpeta para arrastrar y reordenar.
        </p>
      )}
    </div>
  );
}

function FolderTab({
  active,
  icon,
  label,
  count,
  onClick,
  onRename,
  onDelete,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count: number;
  onClick: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="group/tab relative shrink-0">
      <button
        onClick={onClick}
        className={cn(
          "flex h-8 items-center gap-2 rounded-md border px-3 text-[12px] font-medium transition-colors",
          active
            ? "border-blue-500/40 bg-blue-500/10 text-blue-200"
            : "border-zinc-800/70 bg-zinc-950/50 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/60 hover:text-zinc-200",
        )}
      >
        <span className={cn(active ? "text-blue-300" : "text-zinc-500")}>{icon}</span>
        <span className="max-w-[160px] truncate">{label}</span>
        <span
          className={cn(
            "ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold",
            active ? "bg-blue-500/25 text-blue-200" : "bg-zinc-800 text-zinc-400",
          )}
        >
          {count}
        </span>
        {onRename && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((x) => !x);
            }}
            className="ml-0.5 rounded p-0.5 text-zinc-500 opacity-0 transition-opacity hover:bg-zinc-800 hover:text-zinc-200 group-hover/tab:opacity-100"
            title="Más"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </span>
        )}
      </button>
      {menuOpen && onRename && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full z-40 mt-1 w-36 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 shadow-xl">
            <button
              onClick={() => {
                setMenuOpen(false);
                onRename();
              }}
              className="block w-full px-3 py-1.5 text-left text-[11px] text-zinc-200 hover:bg-zinc-900"
            >
              Renombrar
            </button>
            {onDelete && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
                className="block w-full px-3 py-1.5 text-left text-[11px] text-red-300 hover:bg-zinc-900"
              >
                Eliminar
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ConnectionDialog(props: {
  open: boolean;
  form: ConnectionInput;
  plugins: PluginInfo[];
  groups: ConnectionGroup[];
  credentials: CredentialView[];
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
  const visibleValidation = filterVisibleValidation(activeValidation, touchedFields as Record<string, boolean>, submitMode);

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

      if (props.editing) {
        const editingSettings = parseSettings(props.editing.settings_json);
        const prevSelectedDbs = Array.isArray(editingSettings.selectedDatabases)
          ? editingSettings.selectedDatabases
          : [];
        const prevSelectedCollections = editingSettings.selectedCollections && typeof editingSettings.selectedCollections === "object"
          ? (editingSettings.selectedCollections as Record<string, unknown>)
          : {};

        setSelectedDatabases(new Set(prevSelectedDbs));
        setLoadedDatabases(prevSelectedDbs);
        const restoredCollectionsPerDb: Record<string, string[]> = Object.fromEntries(
          Object.entries(prevSelectedCollections).map(([db, collections]) => [
            db,
            Array.isArray(collections) ? (collections as string[]) : []
          ])
        );
        setCollectionsPerDb(restoredCollectionsPerDb);
        const restoredSource: Record<string, "saved" | "server"> = {};
        Object.keys(restoredCollectionsPerDb).forEach((db) => { restoredSource[db] = "saved"; });
        setCollectionsSource(restoredSource);
        const restoredDbsSource: Record<string, "saved" | "server"> = {};
        prevSelectedDbs.forEach((db: string) => { restoredDbsSource[db] = "saved"; });
        setDbsSource(restoredDbsSource);
        setSelectedCollections(
          Object.fromEntries(
            Object.entries(prevSelectedCollections).map(([db, collections]) => [
              db,
              new Set(Array.isArray(collections) ? (collections as string[]) : [])
            ])
          )
        );
        if (prevSelectedDbs.length > 0) setActiveDbTab(prevSelectedDbs[0]);
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
    props.setForm({ ...props.form, settings_json: stringifySettings({ ...settings, [key]: value }) });
  }

  function handleConnectionStringChange(value: string) {
    touch("connectionString");
    if (!value.trim()) {
      setConnectionStringError("");
      props.setForm({ ...props.form, settings_json: stringifySettings(withoutConnectionStringState(settings)) });
      return;
    }
    const parsed = parseConnectionString(value, provider);
    if (!parsed.ok) {
      setConnectionStringError(parsed.error);
      props.setForm({ ...props.form, settings_json: stringifySettings({ ...settings, connectionStringRaw: value }) });
      return;
    }
    setConnectionStringError("");
    props.setForm({ ...props.form, ...parsed.input, settings_json: stringifySettings({ ...settings, ...parsed.settings, connectionStringRaw: value }) });
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
      settings_json: stringifySettings(nextProvider.defaultSettings ?? {})
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
      const retainedSelected = new Set(Array.from(selectedDatabases).filter((db) => availableDatabases.has(db)));
      setLoadedDatabases(databases);
      const serverSource: Record<string, "saved" | "server"> = {};
      databases.forEach((db) => (serverSource[db] = "server"));
      setDbsSource(serverSource);
      setSelectedDatabases(retainedSelected);
      setCollectionsPerDb((prev) => Object.fromEntries(Object.entries(prev).filter(([db]) => availableDatabases.has(db))));
      setSelectedCollections((prev) => Object.fromEntries(Object.entries(prev).filter(([db]) => availableDatabases.has(db))));
      setCollectionsSource((prev) => Object.fromEntries(Object.entries(prev).filter(([db]) => availableDatabases.has(db))));
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
      const collections = await invoke<string[]>("list_collections", { input: props.form, database });
      setCollectionsPerDb((prev) => ({ ...prev, [database]: collections }));
      setCollectionsSource((prev) => ({ ...prev, [database]: "server" }));
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
      setDbsSource((prev) => { const copy = { ...prev }; delete copy[database]; return copy; });
      if (activeDbTab === database) {
        if (newSelected.size > 0) setActiveDbTab(Array.from(newSelected)[0]);
        else setActiveDbTab("");
      }
    } else {
      newSelected.add(database);
      if (provider.id !== "redis") loadCollectionsForDatabase(database);
      setDbsSource((prev) => ({ ...prev, [database]: prev[database] || "server" }));
      if (!activeDbTab) setActiveDbTab(database);
    }
    setSelectedDatabases(newSelected);
  }

  function toggleCollectionSelection(database: string, collection: string) {
    setSelectedCollections((prev) => {
      const dbCollections = prev[database] || new Set();
      const newCollections = new Set(dbCollections);
      if (newCollections.has(collection)) newCollections.delete(collection);
      else newCollections.add(collection);
      return { ...prev, [database]: newCollections };
    });
  }

  function selectAllCollectionsForDatabase(database: string) {
    const collections = collectionsPerDb[database] || [];
    setSelectedCollections((prev) => ({ ...prev, [database]: new Set(collections) }));
  }

  function clearAllCollectionsForDatabase(database: string) {
    setSelectedCollections((prev) => ({ ...prev, [database]: new Set() }));
  }

  function handleSave() {
    const updatedSettings = {
      ...settings,
      selectedDatabases: Array.from(selectedDatabases),
      selectedCollections: Object.fromEntries(
        Object.entries(selectedCollections).map(([db, collections]) => [db, Array.from(collections)])
      )
    };
    const updatedForm = { ...props.form, settings_json: stringifySettings(updatedSettings) };
    setSubmitMode("save");
    setTouchedFields(markFields(saveValidation) as Partial<Record<ValidationField, boolean>>);
    if (Object.keys(saveValidation).length > 0) return;
    props.onSave(updatedForm);
  }

  function handleTest() {
    setSubmitMode("test");
    setTouchedFields(markFields(testValidation) as Partial<Record<ValidationField, boolean>>);
    if (Object.keys(testValidation).length > 0) return;
    props.onTest();
  }

  function handleValidate() {
    setSubmitMode("save");
    setTouchedFields(markFields(saveValidation) as Partial<Record<ValidationField, boolean>>);
    if (Object.keys(saveValidation).length === 0) {
      props.onValidate("Validación correcta.", true);
    } else {
      props.onValidate("Faltan campos: " + Object.values(saveValidation).join("; "), false);
    }
  }

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-x-hidden overflow-y-auto bg-black/45 p-4 backdrop-blur-sm sm:p-6">
      <div className="mx-auto flex min-h-full max-w-[940px] items-center justify-center">
        <div className={cn("w-full overflow-hidden rounded-lg shadow-[0_24px_80px_rgba(0,0,0,.72)]", surface)}>
          <header className={cn("flex h-12 items-center border-b px-5", panel, sectionBorder)}>
            <span className="mr-3 h-4 w-4 shrink-0 overflow-hidden rounded-md border border-white/10 shadow-inner">
              <ProviderIcon providerId={props.form.plugin_id} className="block h-full w-full object-cover" />
            </span>
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
                Provider
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
                      <span className="shrink-0 h-6 w-6 overflow-hidden rounded-md border border-white/10 shadow-inner">
                        <ProviderIcon providerId={plugin.id} className="block h-full w-full object-cover" />
                      </span>
                      <span className="truncate">{plugin.name}</span>
                    </button>
                  );
                })}
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
                  <>
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
                    <div className="mx-auto mt-4 w-full max-w-190">
                      <FormSection title="Carpeta" description="Agrupa esta conexión dentro de una carpeta para organizar tus proyectos.">
                        <select
                          className="h-9 w-full rounded-md border border-zinc-700/70 bg-[#0a0a0a] px-3 text-sm text-zinc-100 outline-none hover:border-zinc-600 focus:border-zinc-500"
                          value={props.form.group_id === null || props.form.group_id === undefined ? "" : String(props.form.group_id)}
                          onChange={(e) => {
                            const v = e.target.value;
                            update("group_id", v === "" ? null : Number(v));
                          }}
                        >
                          <option value="">Sin carpeta</option>
                          {props.groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      </FormSection>
                    </div>
                  </>
                )}
                {visibleTab === "auth" && (
                  <ProviderAuthFields
                    form={props.form}
                    provider={provider}
                    settings={settings}
                    credentials={props.credentials}
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
                    {props.statusOk
                      ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                      : <XCircle className="h-4 w-4 shrink-0 mt-0.5" />}
                    <span className="break-words">{props.status}</span>
                  </div>
                )}
                <div className="flex w-full items-center gap-3">
                  <Button onClick={handleTest} disabled={props.busy} className="h-9 border-zinc-700/70 bg-[#0a0a0a] text-zinc-300">
                    {props.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                    Probar
                  </Button>
                  <div className="flex-1" />
                  <div className="flex gap-2">
                    <Button onClick={() => props.onOpenChange(false)} className="h-9 border-zinc-700/70 bg-[#0a0a0a] text-zinc-300">
                      Cancelar
                    </Button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={props.busy}
                      className="inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-semibold text-white transition-all disabled:opacity-50"
                      style={{ backgroundColor: provider.color, boxShadow: `0 4px 14px ${provider.color}40` }}
                    >
                      {props.busy && <Loader2 className="h-4 w-4 animate-spin" />}
                      Guardar
                    </button>
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

function ProviderGeneralFields({
  form, provider, settings, connectionString, validation, onConnectionStringChange, update, updateSetting, touch
}: {
  form: ConnectionInput; provider: ProviderUi; settings: Record<string, unknown>; connectionString: string;
  validation: Record<string, string>; onConnectionStringChange: (value: string) => void;
  update: ConnectionUpdater; updateSetting: SettingUpdater; touch: (field: ValidationField) => void;
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

function CredentialPickerField({
  form,
  credentials,
  update,
}: {
  form: ConnectionInput;
  credentials: CredentialView[];
  update: ConnectionUpdater;
}) {
  const selectedId = form.credential_id ?? null;
  return (
    <FormSection
      title="Credencial guardada"
      description="Reutiliza un usuario/contraseña guardado. Si seleccionas uno, los campos de abajo se ignoran al conectar."
    >
      <select
        className="h-9 w-full rounded-md border border-zinc-700/70 bg-[#0a0a0a] px-3 text-sm text-zinc-100 outline-none hover:border-zinc-600 focus:border-zinc-500"
        value={selectedId === null ? "" : String(selectedId)}
        onChange={(e) => {
          const v = e.target.value;
          update("credential_id", v === "" ? null : Number(v));
        }}
      >
        <option value="">— Introducir manualmente —</option>
        {credentials.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.username})
          </option>
        ))}
      </select>
      <p className="mt-1 text-[11px] text-zinc-500">
        ¿No ves credenciales? Créalas en{" "}
        <Link to="/settings/credentials" className="underline">
          Ajustes → Credenciales
        </Link>
        .
      </p>
    </FormSection>
  );
}

function ProviderAuthFields({
  form, provider, settings, credentials, update, updateSetting
}: {
  form: ConnectionInput; provider: ProviderUi; settings: Record<string, unknown>;
  credentials: CredentialView[];
  update: ConnectionUpdater; updateSetting: SettingUpdater;
}) {
  const hasCredential = form.credential_id !== null && form.credential_id !== undefined;
  if (provider.id === "redis") {
    return (
      <div className="mx-auto grid w-full max-w-190 gap-5">
        <CredentialPickerField form={form} credentials={credentials} update={update} />
        <FormSection title="Credenciales" description="Usuario opcional (Redis 6+ ACL). Contraseña opcional según configuración del servidor.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ModalField label="Usuario (opcional)" value={form.username} onChange={(value) => update("username", value)} placeholder={hasCredential ? "(usando credencial)" : "Ingresa el nombre de usuario"} />
            <ModalField label="Contraseña (opcional)" type="password" value={form.password} onChange={(value) => update("password", value)} placeholder={hasCredential ? "(usando credencial)" : "Ingresa la contraseña"} trailing={<Eye className="h-3.5 w-3.5" />} />
          </div>
        </FormSection>
      </div>
    );
  }
  if (provider.id === "mongodb") {
    return (
      <div className="mx-auto grid w-full max-w-190 gap-5">
        <CredentialPickerField form={form} credentials={credentials} update={update} />
        <FormSection title="Credenciales">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ModalField label="Usuario" value={form.username} onChange={(value) => update("username", value)} placeholder={hasCredential ? "(usando credencial)" : "Ingresa el nombre de usuario"} />
            <ModalField label="Contraseña" type="password" value={form.password} onChange={(value) => update("password", value)} placeholder={hasCredential ? "(usando credencial)" : "Ingresa la contraseña"} trailing={<Eye className="h-3.5 w-3.5" />} />
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
      <CredentialPickerField form={form} credentials={credentials} update={update} />
      <FormSection title="Credenciales">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ModalField label="Usuario" value={form.username} onChange={(value) => update("username", value)} placeholder={hasCredential ? "(usando credencial)" : "Ingresa el nombre de usuario"} />
          <ModalField label="Contraseña" type="password" value={form.password} onChange={(value) => update("password", value)} placeholder={hasCredential ? "(usando credencial)" : "Ingresa la contraseña"} trailing={<Eye className="h-3.5 w-3.5" />} />
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
  form, provider, loadedDatabases, selectedDatabases, collectionsPerDb, selectedCollections,
  dbsSource, collectionsSource, loadingDatabases, loadingCollections, collectionsError,
  databaseLoadError, activeDbTab, onLoadDatabases, onRefreshDatabase, onToggleDatabase,
  onToggleCollection, onSelectAllCollections, onClearAllCollections, onActiveDbTabChange
}: {
  form: ConnectionInput; provider: ProviderUi; loadedDatabases: string[]; selectedDatabases: Set<string>;
  collectionsPerDb: Record<string, string[]>; selectedCollections: Record<string, Set<string>>;
  dbsSource: Record<string, "saved" | "server">; collectionsSource: Record<string, "saved" | "server">;
  loadingDatabases: boolean; loadingCollections: Record<string, boolean>;
  collectionsError: Record<string, string>; databaseLoadError: string; activeDbTab: string;
  onLoadDatabases: () => void; onRefreshDatabase: (database: string) => void;
  onToggleDatabase: (database: string) => void; onToggleCollection: (database: string, collection: string) => void;
  onSelectAllCollections: (database: string) => void; onClearAllCollections: (database: string) => void;
  onActiveDbTabChange: (database: string) => void;
}) {
  const collectionLabel = provider.id === "postgresql" ? "tablas" : "colecciones";
  const collectionLabelCap = provider.id === "postgresql" ? "Tablas" : "Colecciones";

  return (
    <div className="mx-auto grid w-full max-w-190 gap-5">
      <FormSection title="Cargar Bases de Datos" description="Haz click en 'Cargar bases' para obtener todas las bases de datos disponibles en esta conexión.">
        <Button onClick={onLoadDatabases} disabled={loadingDatabases} className="w-fit border-zinc-700/70 bg-[#0a0a0a] text-zinc-300 hover:bg-zinc-900">
          {loadingDatabases ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Database className="h-4 w-4 mr-2" />}
          {loadingDatabases ? "Cargando..." : "Cargar bases"}
        </Button>
        {databaseLoadError && (
          <p className="mt-2 rounded-md border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs text-red-200">{databaseLoadError}</p>
        )}
      </FormSection>

      {loadedDatabases.length > 0 && (
        <FormSection title="Seleccionar Bases de Datos" description={`Se encontraron ${loadedDatabases.length} base(s). Selecciona las que desees explorar.`}>
          <div className="grid gap-2 rounded-md border border-zinc-800/80 bg-[#0c0c0c] p-3">
            {loadedDatabases.map((database) => (
              <label key={database} className="flex items-center gap-2 justify-between">
                <div className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={selectedDatabases.has(database)} onChange={() => onToggleDatabase(database)} className="w-4 h-4 rounded border-zinc-600 bg-zinc-900 cursor-pointer" />
                  <span className="text-sm text-zinc-300">{database}</span>
                  {(dbsSource[database] === "saved" || collectionsSource[database] === "saved") && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-zinc-700/80 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                      Cacheada
                    </span>
                  )}
                </div>
                <Button size="sm" variant="ghost" onClick={() => onRefreshDatabase(database)} className="h-7 px-2 text-xs border-zinc-700/70 bg-transparent text-zinc-300 hover:bg-zinc-800">Actualizar</Button>
              </label>
            ))}
          </div>
        </FormSection>
      )}

      {selectedDatabases.size > 0 && provider.id !== "redis" && (
        <FormSection title={`${collectionLabelCap} por Base de Datos`}>
          <div className="border border-zinc-800/80 rounded-md bg-[#0c0c0c] overflow-hidden">
            <div className="flex border-b border-zinc-800/80 overflow-x-auto px-3">
              {Array.from(selectedDatabases).map((database) => (
                <button
                  key={database}
                  onClick={() => onActiveDbTabChange(database)}
                  className={cn("px-4 py-2 text-sm border-b-2 border-transparent whitespace-nowrap transition-colors", activeDbTab === database ? "border-blue-500 text-white" : "text-zinc-400 hover:text-zinc-200")}
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
            {activeDbTab && (
              <div className="p-4">
                {loadingCollections[activeDbTab] ? (
                  <div className="flex items-center gap-2 text-zinc-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cargando {collectionLabel}...
                  </div>
                ) : collectionsError[activeDbTab] ? (
                  <p className="text-xs text-red-400">{collectionsError[activeDbTab]}</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-medium text-zinc-400">{(collectionsPerDb[activeDbTab] || []).length} {collectionLabel}</span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => onSelectAllCollections(activeDbTab)} className="h-7 px-2 text-xs border-zinc-700/70 bg-transparent text-zinc-300 hover:bg-zinc-800">Seleccionar todas</Button>
                        <Button size="sm" variant="ghost" onClick={() => onClearAllCollections(activeDbTab)} className="h-7 px-2 text-xs border-zinc-700/70 bg-transparent text-zinc-300 hover:bg-zinc-800">Limpiar</Button>
                        <Button size="sm" variant="ghost" onClick={() => onRefreshDatabase(activeDbTab)} className="h-7 px-2 text-xs border-zinc-700/70 bg-transparent text-zinc-300 hover:bg-zinc-800">Actualizar</Button>
                      </div>
                    </div>
                    <div className="grid gap-2 max-h-64 overflow-y-auto rounded border border-zinc-800/50 bg-zinc-950/30 p-2">
                      {(collectionsPerDb[activeDbTab] || []).length === 0 ? (
                        <p className="text-xs text-zinc-500 text-center py-4">No hay {collectionLabel} disponibles</p>
                      ) : (
                        (collectionsPerDb[activeDbTab] || []).map((collection) => (
                          <label key={collection} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-zinc-900 rounded">
                            <input type="checkbox" checked={selectedCollections[activeDbTab]?.has(collection) ?? false} onChange={() => onToggleCollection(activeDbTab, collection)} className="w-4 h-4 rounded border-zinc-600 bg-zinc-900 cursor-pointer" />
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
          <div className="text-sm text-zinc-400">Bases de datos disponibles: {loadedDatabases.length}</div>
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
        <h3 className="text-[10px] font-semibold uppercase tracking-[.08em] text-zinc-400">{title}</h3>
        {description && <p className={cn("mt-1 max-w-2xl text-xs leading-5", softText)}>{description}</p>}
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function FormOptions({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-2 rounded-md border border-zinc-800/80 bg-[#0c0c0c] px-3 py-2.5">{children}</div>
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
  label, value, onChange, type = "text", placeholder, readOnly, trailing, error, onBlur
}: {
  label: string; value: string; onChange?: (value: string) => void; onBlur?: () => void;
  type?: string; placeholder?: string; readOnly?: boolean; trailing?: React.ReactNode; error?: string;
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
          <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors">
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
  label, value, options, onChange
}: {
  label: string; value: string;
  options: Array<string | { value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const normalizedOptions = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option
  );

  return (
    <label className={cn("grid gap-1.5 text-[10px] font-medium uppercase tracking-[.08em]", mutedText)}>
      {label}
      <Select value={value} onChange={onChange} options={normalizedOptions} className="h-9 text-[13px] font-medium" />
    </label>
  );
}

function ModalCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={cn("flex items-center gap-2 text-xs", mutedText)}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-3.5 w-3.5 rounded border-zinc-600 bg-[#0a0a0a] accent-white" />
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
          className={cn("h-8 px-3 text-xs font-medium text-zinc-400 transition hover:text-zinc-100", value === option.value && "bg-white text-black hover:text-black")}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function getTabIcon(tab: ModalTabId) {
  if (tab === "auth") return <KeyRound className="h-3.5 w-3.5" />;
  if (tab === "advanced") return <Settings className="h-3.5 w-3.5" />;
  if (tab === "ssl") return <Shield className="h-3.5 w-3.5" />;
  if (tab === "ssh") return <KeyRound className="h-3.5 w-3.5" />;
  if (tab === "databases") return <Network className="h-3.5 w-3.5" />;
  return <Database className="h-3.5 w-3.5" />;
}
