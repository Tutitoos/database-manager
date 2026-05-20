
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
import { useNavigate, useSearchParams } from "@/lib/router-compat";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useState } from "react";
import { APP_EVENT, on as onBus } from "@/lib/app-bus";
import { useSessionsStore } from "@/store/sessions";
import { Modal } from "@/components/modal";
import { useOpenConnection } from "@/components/connect-gate";
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
import { mutedText, panel, sectionBorder, softText, surface } from "@/lib/styles";
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
// passphraseStatus removed — credentials live server-side now.
import { useDebounced } from "@/lib/use-debounce";
import { useConnectionStatus, type ConnStatus } from "@/lib/connection-status";
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
  const { t } = useTranslation();
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
  }

  async function renameFolder(id: number, name: string) {
    await invoke("update_group", { id, name });
    await refresh();
  }

  async function deleteFolder(id: number) {
    await invoke("delete_group", { id, reassignTo: null });
    if (activeGroupId === id) setActiveGroupId("__all__");
    await refresh();
  }

  async function reorderInGroup(ids: number[]) {
    await invoke("reorder_connections", { ids });
    await refresh();
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

  const openCreate = useCallback(() => {
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
      settings_json: stringifySettings(provider.defaultSettings ?? {}),
    });
    setStatus("");
    setDialogOpen(true);
  }, [enabledPlugins]);

  // Listen for menu / global bus "newConnection" events.
  useEffect(() => {
    const off = onBus(APP_EVENT.newConnection, openCreate);
    return off;
  }, [openCreate]);

  // Cross-route deep link: /connections?new=1 (used by the dashboard
  // quick-action). Reads on mount so there's no setTimeout race with the
  // bus listener registering.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    openCreate();
    setSearchParams((p) => {
      p.delete("new");
      return p;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const { id: _id, position: _pos, created_at: _created, updated_at: _updated, ...input } = connection;
    await invoke("create_connection", { input: { ...input, name: `${connection.name} copia` } });
    await refresh();
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
          "fixed bottom-5 right-5 flex max-w-md items-center gap-2 rounded-md border px-4 py-3 text-h3 shadow-[0_16px_48px_rgba(0,0,0,.55)]",
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
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const navigate = useNavigate();
  const { sessions, removeSession } = useSessionsStore();
  const openConnection = useOpenConnection();
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

  async function connectTo(connection: Connection) {
    try {
      await openConnection(connection);
      // Success: clear stale fail badge if any. User navigates away anyway.
      setTestResults((prev) => {
        const { [connection.id]: _gone, ...rest } = prev;
        void _gone;
        return rest;
      });
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [connection.id]: { ms: null, loading: false, ok: false },
      }));
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
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", panel)}>
      {/* Header: title + inline metrics pill + primary CTA */}
      <header className={cn("flex h-14 items-center justify-between gap-4 border-b px-5", panel, sectionBorder)}>
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border-subtle bg-surface-elevated text-text">
            <Database strokeWidth={1.5} className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-h1 truncate text-text">{t("connectionsPage.title")}</h1>
            <p className={cn("text-caption truncate", mutedText)}>
              {props.total} {props.total === 1 ? t("connectionsPage.summarySingular", { defaultValue: "conexión configurada" }) : t("connectionsPage.summaryPlural", { defaultValue: "conexiones configuradas" })}
            </p>
          </div>
        </div>
        <Button variant="primary" size="sm" onClick={props.onCreate}>
          <Plus className="h-3.5 w-3.5" /> {t("connectionsPage.newConnection")}
        </Button>
      </header>

      {/* Toolbar: search + view toggle on one row */}
      <div className={cn("flex min-w-0 items-center gap-2 border-b px-5 py-2", panel, sectionBorder)}>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-2 h-3.5 w-3.5 text-text-faint" />
          <Input
            className="h-8 pl-8 text-body"
            placeholder={t("connectionsPage.searchPlaceholder")}
            value={props.query}
            onChange={(event) => props.setQuery(event.target.value)}
          />
          {props.query && (
            <button
              type="button"
              onClick={() => props.setQuery("")}
              className="absolute right-2 top-2 text-text-faint hover:text-text"
              title={t("common.clearSearch")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex h-8 shrink-0 items-center overflow-hidden rounded-md border border-border-subtle">
          <button
            type="button"
            title={t("connectionsPage.gridView")}
            onClick={() => setViewMode("grid")}
            className={cn(
              "grid h-full w-8 place-items-center transition-colors",
              viewMode === "grid"
                ? "bg-surface-elevated text-text"
                : "text-text-muted hover:bg-surface-hover hover:text-text",
            )}
          >
            <Grid2X2 className="h-3.5 w-3.5" />
          </button>
          <span className="h-full w-px bg-border-subtle" />
          <button
            type="button"
            title={t("connectionsPage.listView")}
            onClick={() => setViewMode("list")}
            className={cn(
              "grid h-full w-8 place-items-center transition-colors",
              viewMode === "list"
                ? "bg-surface-elevated text-text"
                : "text-text-muted hover:bg-surface-hover hover:text-text",
            )}
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

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
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 content-start gap-2.5 overflow-x-hidden overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {props.connections.length === 0 && (
            <EmptyState onCreate={props.onCreate} hasQuery={Boolean(props.query)} />
          )}
          {props.connections.map((connection) => {
            const plugin = props.pluginMap.get(connection.plugin_id);
            const ui = getProviderUi(connection.plugin_id, plugin?.manifest);
            return (
              <SortableArticle
                key={connection.id}
                id={connection.id}
                disabled={dndDisabled}
                className={cn(
                  "group relative flex flex-col gap-2 overflow-hidden rounded-lg border border-border-subtle bg-surface-elevated p-2.5 transition-all hover:border-border-strong hover:shadow-[0_2px_8px_rgba(0,0,0,.25)]",
                )}
              >
                {/* Provider accent bar */}
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-[3px]"
                  style={{ background: ui.color }}
                />
                <ConnectionCardBody
                  connection={connection}
                  pluginName={plugin?.name ?? connection.plugin_id}
                  ui={ui}
                  isOpen={Boolean(sessions[connection.id])}
                  testResult={testResults[connection.id]}
                  onConnect={() => connectTo(connection)}
                  onClose={() => removeSession(connection.id)}
                  onTest={() => testInline(connection)}
                  onEdit={() => props.onEdit(connection)}
                  onDuplicate={() => props.onDuplicate(connection)}
                  onDelete={() => setDeletingConnection(connection)}
                />
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
            <EmptyState onCreate={props.onCreate} hasQuery={Boolean(props.query)} />
          )}
          {props.connections.map((connection) => {
            const plugin = props.pluginMap.get(connection.plugin_id);
            const ui = getProviderUi(connection.plugin_id, plugin?.manifest);
            return (
              <SortableRow
                key={connection.id}
                id={connection.id}
                disabled={dndDisabled}
                className={cn(
                  "group relative flex items-center gap-3 overflow-hidden rounded-lg border border-border-subtle bg-surface-elevated px-4 py-2.5 transition-colors hover:border-border-strong hover:bg-surface-hover",
                )}
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-[3px]"
                  style={{ background: ui.color }}
                />
                <ConnectionRowBody
                  connection={connection}
                  pluginName={plugin?.name ?? connection.plugin_id}
                  ui={ui}
                  isOpen={Boolean(sessions[connection.id])}
                  testResult={testResults[connection.id]}
                  onConnect={() => connectTo(connection)}
                  onTest={() => testInline(connection)}
                  onEdit={() => props.onEdit(connection)}
                  onDuplicate={() => props.onDuplicate(connection)}
                  onDelete={() => setDeletingConnection(connection)}
                />
              </SortableRow>
            );
          })}
        </div>
        </SortableContext>
        </DndContext>
      )}

      {deletingFolder && (
        <Modal onClose={() => setDeletingFolder(null)}>
          <div className="w-full max-w-md rounded-md border border-border-subtle bg-surface p-5 shadow-xl">
            <h2 className="text-h3 font-medium text-text">¿Eliminar carpeta?</h2>
            <p className="mt-2 break-all rounded bg-surface-elevated px-2 py-1 font-mono text-[11px] text-text">{deletingFolder.name}</p>
            <p className="mt-2 text-body text-text-muted">Las conexiones dentro se moverán a "Sin carpeta".</p>
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
          <div className="w-full max-w-md rounded-md border border-border-subtle bg-surface p-5 shadow-xl">
            <h2 className="text-h3 font-medium text-text">¿Eliminar conexión?</h2>
            <p className="mt-2 break-all rounded bg-surface-elevated px-2 py-1 font-mono text-[11px] text-text">
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

type TestResult = { ms: number | null; loading: boolean; ok: boolean } | undefined;

function StatusDot({ status, className }: { status: ConnStatus; className?: string }) {
  const map: Record<ConnStatus, { color: string; label: string; pulse: boolean }> = {
    ok: { color: "bg-emerald-500", label: "Online", pulse: false },
    fail: { color: "bg-red-500", label: "Offline", pulse: false },
    checking: { color: "bg-amber-400", label: "Comprobando…", pulse: true },
    unknown: { color: "bg-text-faint/60", label: "—", pulse: false },
  };
  const s = map[status];
  return (
    <span
      title={s.label}
      className={cn("inline-block h-1.5 w-1.5 rounded-full", s.color, s.pulse && "animate-pulse", className)}
    />
  );
}

function TestBadge({ result }: { result: TestResult }) {
  if (!result) return null;
  if (result.loading) {
    return (
      <span className="text-tiny inline-flex items-center gap-1 text-text-faint">
        <Loader2 className="h-3 w-3 animate-spin" /> probando
      </span>
    );
  }
  if (result.ok) {
    return (
      <span className="text-tiny inline-flex items-center gap-1 font-mono text-emerald-400">
        <Zap className="h-3 w-3" />
        {result.ms != null && <span>{result.ms}ms</span>}
      </span>
    );
  }
  return (
    <span className="text-tiny inline-flex items-center gap-1 text-red-400">
      <XCircle className="h-3 w-3" /> fallo
    </span>
  );
}

function EmptyState({ onCreate, hasQuery }: { onCreate: () => void; hasQuery: boolean }) {
  return (
    <div className="col-span-full grid place-items-center rounded-xl border-2 border-dashed border-border-subtle/60 bg-surface-elevated/30 p-10 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-xl border border-border-subtle bg-surface-hover text-text-muted">
        {hasQuery ? <Search className="h-5 w-5" /> : <Database className="h-5 w-5" />}
      </div>
      <h2 className="mt-4 text-h3 font-semibold text-text">
        {hasQuery ? "Sin resultados" : "No hay conexiones"}
      </h2>
      <p className={cn("mt-1.5 max-w-sm text-body", mutedText)}>
        {hasQuery
          ? "Ajusta la búsqueda o limpia el filtro."
          : "Crea una conexión a PostgreSQL, MongoDB, Redis u otro driver instalado."}
      </p>
      {!hasQuery && (
        <Button variant="primary" size="sm" className="mt-4" onClick={onCreate}>
          <Plus className="h-3.5 w-3.5" /> Nueva conexión
        </Button>
      )}
    </div>
  );
}

function ConnectionCardBody({
  connection,
  pluginName,
  ui,
  isOpen,
  testResult,
  onConnect,
  onClose,
  onTest,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  connection: Connection;
  pluginName: string;
  ui: ProviderUi;
  isOpen: boolean;
  testResult: TestResult;
  onConnect: () => void;
  onClose: () => void;
  onTest: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const status = useConnectionStatus(connection, true);
  return (
    <div className="flex h-full flex-col gap-3 pl-1">
      {/* Header — icon hero + identity + status pill */}
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md border border-border-subtle bg-surface">
          <ProviderIcon providerId={connection.plugin_id} className="block h-full w-full object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-h3 truncate font-semibold text-text">{connection.name}</h3>
            {isOpen && (
              <span className="text-tiny rounded-full bg-accent-soft px-1.5 py-0.5 font-medium text-accent">
                abierta
              </span>
            )}
          </div>
          <p className="text-caption mt-0.5 font-semibold uppercase tracking-wider" style={{ color: ui.color }}>
            {pluginName}
          </p>
          <p
            className="text-body-mono mt-1 truncate text-text-muted"
            title={`${connection.host}:${connection.port ?? "-"}`}
          >
            {connection.host}:{connection.port ?? "-"}
          </p>
        </div>
        <StatusBadge status={status} testResult={testResult} />
      </div>

      {/* Actions toolbar — secondary always visible */}
      <div className="mt-auto flex items-center gap-1 border-t border-border-subtle/60 pt-2">
        <Button variant="ghost" size="icon" title={t("connectionsPage.testConnection")} onClick={onTest} disabled={testResult?.loading}>
          {testResult?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" title={t("common.edit")} onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" title={t("common.duplicate")} onClick={onDuplicate}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
        {isOpen && (
          <Button variant="ghost" size="icon" title={t("connectionsPage.closeTab")} onClick={onClose}>
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="icon" title={t("common.delete")} onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5 text-danger" />
        </Button>
      </div>

      {/* Primary CTA — full width footer */}
      <Button variant="primary" size="md" className="w-full" onClick={onConnect}>
        {isOpen ? <ExternalLink className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
        {isOpen ? "Abrir conexión" : "Conectar"}
      </Button>
    </div>
  );
}

const STATUS_PILL =
  "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none";

function StatusPillDot({ pulse }: { pulse?: boolean }) {
  return (
    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full bg-current", pulse && "animate-pulse")} />
  );
}

function StatusBadge({ status, testResult }: { status: ConnStatus; testResult: TestResult }) {
  if (testResult && !testResult.loading) {
    return testResult.ok ? (
      <span className={cn(STATUS_PILL, "bg-success-soft text-success")}>
        <StatusPillDot />
        {testResult.ms != null ? `${testResult.ms}ms` : "OK"}
      </span>
    ) : (
      <span className={cn(STATUS_PILL, "bg-danger-soft text-danger")}>
        <StatusPillDot />
        Falló
      </span>
    );
  }
  const map: Record<ConnStatus, { cls: string; label: string; pulse?: boolean }> = {
    ok: { cls: "bg-success-soft text-success", label: "Activa" },
    fail: { cls: "bg-danger-soft text-danger", label: "Offline" },
    checking: { cls: "bg-info-soft text-info", label: "Comprobando", pulse: true },
    unknown: { cls: "bg-surface-sunken text-text-faint", label: "—" },
  };
  const s = map[status];
  return (
    <span className={cn(STATUS_PILL, s.cls)}>
      <StatusPillDot pulse={s.pulse} />
      {s.label}
    </span>
  );
}

function ConnectionRowBody({
  connection,
  pluginName,
  ui,
  isOpen,
  testResult,
  onConnect,
  onTest,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  connection: Connection;
  pluginName: string;
  ui: ProviderUi;
  isOpen: boolean;
  testResult: TestResult;
  onConnect: () => void;
  onTest: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const status = useConnectionStatus(connection, true);
  return (
    <>
      <StatusDot status={status} className="ml-1" />
      <div className="h-7 w-7 shrink-0 overflow-hidden rounded-md border border-border-subtle">
        <ProviderIcon providerId={connection.plugin_id} className="block h-full w-full object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-body font-medium text-text">{connection.name}</span>
          {isOpen && (
            <span className="text-tiny rounded-full bg-accent-soft px-1.5 py-0.5 font-medium text-accent">
              {t("connectionsPage.opened", { defaultValue: "abierto" })}
            </span>
          )}
        </div>
        <p className="text-tiny truncate text-text-faint">
          <span style={{ color: ui.color }}>{pluginName}</span>
          <span className="mx-1.5">·</span>
          <span className="font-mono text-text-muted">{connection.host}:{connection.port ?? "-"}</span>
        </p>
      </div>
      <div className="shrink-0">
        <TestBadge result={testResult} />
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
        <Button variant="ghost" size="icon" title={isOpen ? t("connectionsPage.open", { defaultValue: "Abrir" }) : t("connectionsPage.connect", { defaultValue: "Conectar" })} onClick={onConnect}>
          {isOpen ? <ExternalLink className="h-3.5 w-3.5 text-accent" /> : <LogIn className="h-3.5 w-3.5 text-accent" />}
        </Button>
        <Button variant="ghost" size="icon" title={t("connectionsPage.testConnection")} onClick={onTest} disabled={testResult?.loading}>
          {testResult?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" title={t("common.edit")} onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" title={t("common.duplicate")} onClick={onDuplicate}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" title={t("common.delete")} onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5 text-red-400" />
        </Button>
      </div>
    </>
  );
}

function SortableArticle({ id, disabled, className, children }: { id: number; disabled?: boolean; className?: string; children: React.ReactNode }) {
  const { t } = useTranslation();
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
          aria-label={t("connectionsPage.drag")}
          title={t("connectionsPage.dragToReorder")}
          className="absolute left-1 top-1/2 z-10 -translate-y-1/2 rounded-md p-1 text-text-faint opacity-40 transition-opacity hover:bg-surface-hover/70 hover:text-text hover:opacity-100 group-hover:opacity-80 cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      {children}
    </article>
  );
}

function SortableRow({ id, disabled, className, children }: { id: number; disabled?: boolean; className?: string; children: React.ReactNode }) {
  const { t } = useTranslation();
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
          aria-label={t("connectionsPage.drag")}
          title={t("connectionsPage.dragToReorder")}
          className="cursor-grab text-text-faint hover:text-text active:cursor-grabbing touch-none"
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
  const { t } = useTranslation();
  return (
    <div className={cn("border-b px-5 py-2", panel, sectionBorder)}>
      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
        <FolderTab
          active={activeGroupId === "__all__"}
          icon={<Layers className="h-3.5 w-3.5" />}
          label={t("connectionsPage.allFolders")}
          count={countAll}
          onClick={() => setActiveGroupId("__all__")}
        />
        {/* Nueva carpeta sits next to the pills so the row scans as a single unit */}
        {groups.length > 0 && (
          <>
            <FolderTab
              active={activeGroupId === null}
              icon={<Inbox className="h-3.5 w-3.5" />}
              label={t("connectionsPage.noFolder")}
              count={countNoGroup}
              onClick={() => setActiveGroupId(null)}
            />
            <span className="mx-1 h-5 w-px shrink-0 bg-surface-hover/70" />
          </>
        )}
        {groups.map((g) => (
          <FolderTab
            key={g.id}
            active={activeGroupId === g.id}
            icon={<Folder className="h-3.5 w-3.5" />}
            label={g.name}
            count={countByGroup.get(g.id) ?? 0}
            onClick={() => setActiveGroupId(g.id)}
            onRename={async () => {
              const next = window.prompt(t("connectionsPage.renamePrompt", { defaultValue: "Nuevo nombre" }), g.name);
              if (next && next.trim() && next.trim() !== g.name) await onRename(g.id, next.trim());
            }}
            onDelete={() => onDelete(g)}
          />
        ))}
        {creatingFolder ? (
          <div className="flex items-center gap-1">
            <Input
              autoFocus
              className="h-8 w-44 text-body"
              placeholder={t("connectionsPage.folderNamePlaceholder")}
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
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-dashed border-border-strong/60 px-2 text-[11px] text-text-muted transition-colors hover:border-border-strong hover:bg-surface-elevated/60 hover:text-text"
            title={t("connectionsPage.createFolder")}
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("connectionsPage.newFolder")}</span>
          </button>
        )}
        {dndDisabled && activeGroupId === "__all__" && groups.length > 0 && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[10.5px] text-text-faint">
            <GripVertical className="h-3 w-3" />
            Filtra por carpeta para reordenar
          </span>
        )}
      </div>
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
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="group/tab relative shrink-0">
      <button
        onClick={onClick}
        className={cn(
          "flex h-8 items-center gap-2 rounded-md border px-3 text-[12px] font-medium transition-colors",
          active
            ? "border-accent/40 bg-accent-soft text-text"
            : "border-border-subtle bg-surface-sunken text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text",
        )}
      >
        <span className={cn(active ? "text-accent" : "text-text-faint")}>{icon}</span>
        <span className="max-w-[160px] truncate">{label}</span>
        <span
          className={cn(
            "ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold",
            active ? "bg-accent-soft text-accent" : "bg-surface-sunken text-text-muted",
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
            className="ml-0.5 rounded p-0.5 text-text-faint opacity-0 transition-opacity hover:bg-surface-hover hover:text-text group-hover/tab:opacity-100"
            title={t("common.more")}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </span>
        )}
      </button>
      {menuOpen && onRename && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full z-40 mt-1 w-36 overflow-hidden rounded-md border border-border-subtle bg-surface shadow-xl">
            <button
              onClick={() => {
                setMenuOpen(false);
                onRename();
              }}
              className="block w-full px-3 py-1.5 text-left text-[11px] text-text hover:bg-surface-elevated"
            >
              Renombrar
            </button>
            {onDelete && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
                className="block w-full px-3 py-1.5 text-left text-[11px] text-red-300 hover:bg-surface-elevated"
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
  const { t } = useTranslation();
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
    <div className="fixed inset-0 z-50 overflow-x-hidden overflow-y-auto bg-black/55 p-3 backdrop-blur-sm sm:p-6">
      <div className="mx-auto flex min-h-full max-w-[820px] items-start justify-center">
        <div className={cn("flex max-h-[calc(100vh-1.5rem)] w-full flex-col overflow-hidden rounded-xl border border-border-subtle shadow-[0_24px_80px_rgba(0,0,0,.72)]", surface)}>
          {/* Header */}
          <header className={cn("flex h-12 items-center gap-3 border-b px-5", panel, sectionBorder)}>
            <h2 className="text-h2 font-semibold text-text">
              {props.editing ? t("connectionsPage.editConnection") : t("connectionsPage.newConnection")}
            </h2>
            {props.editing && (
              <Badge className="border-border-subtle bg-surface-elevated text-text-muted">{provider.name}</Badge>
            )}
            <button
              type="button"
              onClick={() => props.onOpenChange(false)}
              className="ml-auto text-text-faint transition hover:text-text"
              aria-label={t("common.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          {/* Provider picker (horizontal cards) + Name */}
          <div className={cn("border-b px-5 py-4", panel, sectionBorder)}>
            <label className="text-overline mb-2 block">{t("connectionsPage.form.provider")}</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {props.plugins.map((plugin) => {
                const isActive = plugin.id === props.form.plugin_id;
                const isLocked = !!props.editing;
                return (
                  <button
                    key={plugin.id}
                    type="button"
                    disabled={isLocked && !isActive}
                    onClick={() => !isLocked && selectPlugin(plugin)}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-lg border bg-surface px-3 py-2 text-left transition-all",
                      isActive
                        ? "border-accent/50 bg-accent-soft shadow-[0_0_0_1px] shadow-accent/30"
                        : "border-border-subtle hover:border-border-strong hover:bg-surface-hover",
                      isLocked && !isActive && "cursor-not-allowed opacity-30 hover:border-border-subtle hover:bg-surface",
                    )}
                  >
                    <span className="h-7 w-7 shrink-0 overflow-hidden rounded-md border border-border-subtle bg-surface-elevated">
                      <ProviderIcon providerId={plugin.id} className="block h-full w-full object-cover" />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className={cn("truncate text-[13px] font-medium", isActive ? "text-text" : "text-text-muted")}>
                        {plugin.name}
                      </span>
                      <span className="text-[10px] text-text-faint">{plugin.id}</span>
                    </span>
                    {isActive && (
                      <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    )}
                  </button>
                );
              })}
            </div>

            <label className="text-overline mb-1.5 mt-4 block">{t("connectionsPage.form.name")}</label>
            <Input
              autoFocus
              placeholder={t("connectionsPage.form.namePlaceholder")}
              value={props.form.name}
              onChange={(event) => update("name", event.target.value)}
              onBlur={() => touch("name")}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <section className={cn("flex min-h-0 min-w-0 flex-col", panel)}>
              <nav className={cn("flex h-10 items-end border-b px-5", panel, sectionBorder)}>
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
                      <FormSection title={t("connectionsPage.form.folder")} description={t("connectionsPage.form.folderDescription")}>
                        <select
                          className="h-9 w-full rounded-md border border-border-strong bg-[#0a0a0a] px-3 text-h3 text-text outline-none hover:border-border-strong focus:border-border-strong"
                          value={props.form.group_id === null || props.form.group_id === undefined ? "" : String(props.form.group_id)}
                          onChange={(e) => {
                            const v = e.target.value;
                            update("group_id", v === "" ? null : Number(v));
                          }}
                        >
                          <option value="">{t("connectionsPage.noFolder")}</option>
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

              <footer className={cn("flex flex-col gap-2 border-t px-5 py-3", panel, sectionBorder)}>
                {props.status && (
                  <div
                    className={cn(
                      "flex max-h-24 w-full items-start gap-2 overflow-y-auto rounded-md border px-3 py-2 text-body font-medium",
                      props.statusOk
                        ? "border-success/40 bg-success-soft text-success"
                        : "border-danger/40 bg-danger-soft text-danger",
                    )}
                  >
                    {props.statusOk ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <span className="break-words">{props.status}</span>
                  </div>
                )}
                <div className="flex w-full items-center justify-between gap-3">
                  <Button variant="secondary" size="sm" onClick={handleTest} disabled={props.busy}>
                    {props.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    {t("connectionsPage.test")}
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => props.onOpenChange(false)} disabled={props.busy}>
                      {t("common.cancel")}
                    </Button>
                    <Button variant="primary" size="sm" onClick={handleSave} disabled={props.busy}>
                      {props.busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {props.editing ? t("connectionsPage.saveChanges") : t("connectionsPage.createConnection")}
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
        className="h-9 w-full rounded-md border border-border-strong bg-[#0a0a0a] px-3 text-h3 text-text outline-none hover:border-border-strong focus:border-border-strong"
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
      <p className="mt-1 text-[11px] text-text-faint">
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
          <p className={cn("text-h3", mutedText)}>Este provider no tiene opciones avanzadas en esta versión.</p>
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
        <Button onClick={onLoadDatabases} disabled={loadingDatabases} className="w-fit border-border-strong bg-[#0a0a0a] text-text hover:bg-surface-elevated">
          {loadingDatabases ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Database className="h-4 w-4 mr-2" />}
          {loadingDatabases ? "Cargando..." : "Cargar bases"}
        </Button>
        {databaseLoadError && (
          <p className="mt-2 rounded-md border border-red-900/60 bg-red-950/20 px-3 py-2 text-body text-red-200">{databaseLoadError}</p>
        )}
      </FormSection>

      {loadedDatabases.length > 0 && (
        <FormSection title="Seleccionar Bases de Datos" description={`Se encontraron ${loadedDatabases.length} base(s). Selecciona las que desees explorar.`}>
          <div className="grid gap-2 rounded-md border border-border-subtle bg-[#0c0c0c] p-3">
            {loadedDatabases.map((database) => (
              <label key={database} className="flex items-center gap-2 justify-between">
                <div className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={selectedDatabases.has(database)} onChange={() => onToggleDatabase(database)} className="w-4 h-4 rounded border-border-strong bg-surface-elevated cursor-pointer" />
                  <span className="text-h3 text-text">{database}</span>
                  {(dbsSource[database] === "saved" || collectionsSource[database] === "saved") && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-border-strong/80 bg-surface-elevated px-2 py-0.5 text-[10px] text-text">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                      Cacheada
                    </span>
                  )}
                </div>
                <Button size="sm" variant="ghost" onClick={() => onRefreshDatabase(database)} className="h-7 px-2 text-body border-border-strong bg-transparent text-text hover:bg-surface-hover">Actualizar</Button>
              </label>
            ))}
          </div>
        </FormSection>
      )}

      {selectedDatabases.size > 0 && provider.id !== "redis" && (
        <FormSection title={`${collectionLabelCap} por Base de Datos`}>
          <div className="border border-border-subtle rounded-md bg-[#0c0c0c] overflow-hidden">
            <div className="flex border-b border-border-subtle overflow-x-auto px-3">
              {Array.from(selectedDatabases).map((database) => (
                <button
                  key={database}
                  onClick={() => onActiveDbTabChange(database)}
                  className={cn("px-4 py-2 text-h3 border-b-2 border-transparent whitespace-nowrap transition-colors", activeDbTab === database ? "border-blue-500 text-text" : "text-text-muted hover:text-text")}
                >
                  <span className="inline-flex items-center gap-2">
                    <span>{database}</span>
                    {collectionsSource[database] === "saved" && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-border-strong/80 bg-surface-elevated px-2 py-0.5 text-[10px] text-text">
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
                  <div className="flex items-center gap-2 text-text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cargando {collectionLabel}...
                  </div>
                ) : collectionsError[activeDbTab] ? (
                  <p className="text-body text-red-400">{collectionsError[activeDbTab]}</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-body font-medium text-text-muted">{(collectionsPerDb[activeDbTab] || []).length} {collectionLabel}</span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => onSelectAllCollections(activeDbTab)} className="h-7 px-2 text-body border-border-strong bg-transparent text-text hover:bg-surface-hover">Seleccionar todas</Button>
                        <Button size="sm" variant="ghost" onClick={() => onClearAllCollections(activeDbTab)} className="h-7 px-2 text-body border-border-strong bg-transparent text-text hover:bg-surface-hover">Limpiar</Button>
                        <Button size="sm" variant="ghost" onClick={() => onRefreshDatabase(activeDbTab)} className="h-7 px-2 text-body border-border-strong bg-transparent text-text hover:bg-surface-hover">Actualizar</Button>
                      </div>
                    </div>
                    <div className="grid gap-2 max-h-64 overflow-y-auto rounded border border-border-subtle/50 bg-surface/30 p-2">
                      {(collectionsPerDb[activeDbTab] || []).length === 0 ? (
                        <p className="text-body text-text-faint text-center py-4">No hay {collectionLabel} disponibles</p>
                      ) : (
                        (collectionsPerDb[activeDbTab] || []).map((collection) => (
                          <label key={collection} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-surface-elevated rounded">
                            <input type="checkbox" checked={selectedCollections[activeDbTab]?.has(collection) ?? false} onChange={() => onToggleCollection(activeDbTab, collection)} className="w-4 h-4 rounded border-border-strong bg-surface-elevated cursor-pointer" />
                            <span className="text-h3 text-text">{collection}</span>
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
          <div className="text-h3 text-text-muted">Bases de datos disponibles: {loadedDatabases.length}</div>
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
        <h3 className="text-[10px] font-semibold uppercase tracking-[.08em] text-text-muted">{title}</h3>
        {description && <p className={cn("mt-1 max-w-2xl text-body leading-5", softText)}>{description}</p>}
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function FormOptions({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-2 rounded-md border border-border-subtle bg-[#0c0c0c] px-3 py-2.5">{children}</div>
  );
}

function ModalTab({ active, icon, label, onClick }: { active?: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative inline-flex h-11 max-w-65 items-center gap-1.5 truncate border-b-2 border-transparent px-0 text-body font-semibold text-text-faint transition-colors hover:text-text",
        active && "border-blue-500 text-text"
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
            "h-9 border-border-strong bg-[#0a0a0a] px-3 text-[13px] font-medium text-text placeholder:font-normal placeholder:italic placeholder:text-text-faint",
            (isPasswordField || trailing) && "pr-11",
            readOnly && "text-text-muted",
            error && "border-red-900 focus:border-red-700 focus:ring-red-900/20"
          )}
        />
        {isPasswordField ? (
          <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-text-faint hover:text-text transition-colors">
            {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        ) : (
          trailing && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-text-faint">{trailing}</span>
        )}
      </span>
      {error && <span className="text-body normal-case tracking-normal text-red-400">{error}</span>}
    </label>
  );
}

function InlineError({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-red-900/60 bg-red-950/20 px-3 py-2 text-body text-red-200">{children}</p>;
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
    <label className={cn("flex items-center gap-2 text-body", mutedText)}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-3.5 w-3.5 rounded border-border-strong bg-[#0a0a0a] accent-white" />
      {label}
    </label>
  );
}

function SegmentedControl({ value, options, onChange }: { value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <div className="inline-flex max-w-full overflow-hidden rounded-md border border-border-strong bg-[#0a0a0a]">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn("h-8 px-3 text-body font-medium text-text-muted transition hover:text-text", value === option.value && "bg-white text-black hover:text-black")}
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
