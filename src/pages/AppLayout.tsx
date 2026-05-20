import { invoke } from "@tauri-apps/api/core";
import { Boxes } from "lucide-react";
import { Outlet } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "@/lib/router-compat";
import { SafariTabsStrip, TabContextMenu, type SafariTab } from "@/components/shell/SafariTabsStrip";
import { ShellToolbar } from "@/components/shell/ShellToolbar";
import { Sidebar } from "@/components/shell/Sidebar";
import { InspectorPane } from "@/components/shell/InspectorPane";
import { StatusBar } from "@/components/shell/StatusBar";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { ToastProvider, pushToast } from "@/components/ui/toast";
import { ConnectGateProvider, useOpenConnection } from "@/components/connect-gate";
import { InspectorProvider, useInspector } from "@/lib/inspector";
import { ProviderIcon, PROVIDER_UI } from "@/lib/providers";
import { useLocaleSync } from "@/i18n";
import { useAction } from "@/lib/use-action";
import { loadZoom, zoomIn, zoomOut, zoomReset } from "@/lib/zoom";
import { useAppMenuEvents } from "@/lib/app-menu";
import { APP_EVENT, emit as busEmit } from "@/lib/app-bus";
import { useSessionsStore, type Session } from "@/store/sessions";
import { refreshOrgs } from "@/store/orgs";
import { loadSettings } from "@/store/settings";
import { currentVersion, findUpdate, openReleasePage } from "@/lib/updates";
import { listen } from "@tauri-apps/api/event";

const DASHBOARD_TAB_ID = "__dashboard";

export default function AppLayout() {
  return (
    <ToastProvider>
      <InspectorProvider>
        <ConnectGateProvider>
          <Shell />
        </ConnectGateProvider>
      </InspectorProvider>
    </ToastProvider>
  );
}

function Shell() {
  useLocaleSync();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { sessions, removeSession } = useSessionsStore();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<Set<number>>(new Set());
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const inspector = useInspector();
  const openConnection = useOpenConnection();

  // Toast for keychain save outcomes (so user knows if Touch ID persisted).
  useEffect(() => {
    const u1 = listen<string>("vault:keychain-error", (e) => {
      pushToast({ level: "danger", title: "No se guardó en keychain", body: String(e.payload), ttl: 8000 });
    });
    const u2 = listen<boolean>("vault:keychain-saved", (e) => {
      pushToast({
        level: "success",
        title: e.payload ? "Clave guardada con Touch ID" : "Clave guardada en keychain",
        body: e.payload ? "Próximo arranque pedirá huella." : "Auto-unlock activo.",
      });
    });
    return () => {
      void u1.then((fn) => fn()).catch(() => undefined);
      void u2.then((fn) => fn()).catch(() => undefined);
    };
  }, []);

  // Listen for invite deep-links: database-manager://invite?server=...&token=...
  useEffect(() => {
    const unlistenP = listen<string[]>("auth:deep-link", (event) => {
      for (const url of event.payload ?? []) {
        try {
          const u = new URL(url);
          if (u.host === "invite" || u.pathname.startsWith("/invite")) {
            const server = u.searchParams.get("server") ?? "";
            const token = u.searchParams.get("token") ?? "";
            if (server && token) {
              navigate(`/invite?server=${encodeURIComponent(server)}&token=${encodeURIComponent(token)}`);
            }
          }
        } catch { /* ignore malformed */ }
      }
    });
    return () => { void unlistenP.then((fn) => fn()).catch(() => undefined); };
  }, [navigate]);

  // Hydrate orgs on mount. We do *not* auto-switch to a local org when the
  // user appears signed-out: a stale `auth_current_user` result (e.g. caused
  // by a transient sync 401 that already cleared app_user) would otherwise
  // yank the active org back to Local mid-session — which the user reads as
  // a bug because their selected org disappears under them.
  useEffect(() => {
    void refreshOrgs();
    void (async () => {
      const cfg = await loadSettings();
      if (!cfg.restoreLastSession) {
        useSessionsStore.getState().hydrate({});
        return;
      }
      try {
        const json = await invoke<string | null>("load_sessions");
        const data = json ? (JSON.parse(json) as Record<number, Session>) : {};
        useSessionsStore.getState().hydrate(data);
      } catch {
        useSessionsStore.getState().hydrate({});
      }
    })();
  }, []);

  // Load pinned tabs.
  useEffect(() => {
    invoke<string | null>("get_app_setting", { key: "app.pinned_tabs" })
      .then((raw) => {
        if (!raw) return;
        try {
          const ids = JSON.parse(raw) as number[];
          setPinnedIds(new Set(Array.isArray(ids) ? ids : []));
        } catch {
          /* ignore */
        }
      })
      .catch(() => undefined);
  }, []);

  function persistPinned(next: Set<number>) {
    void invoke("set_app_setting", {
      key: "app.pinned_tabs",
      valueJson: JSON.stringify([...next]),
    }).catch(() => undefined);
  }

  useAction("commandPalette", (e) => { e.preventDefault(); setPaletteOpen((o) => !o); }, { whenInInput: true });
  useAction("focusSearch", (e) => { e.preventDefault(); setPaletteOpen(true); }, { whenInInput: true });
  useAction("toggleInspector", (e) => { e.preventDefault(); inspector.toggle(); }, { whenInInput: true });
  useAction("zoomIn", (e) => { e.preventDefault(); void zoomIn(); }, { whenInInput: true });
  useAction("zoomOut", (e) => { e.preventDefault(); void zoomOut(); }, { whenInInput: true });
  useAction("zoomReset", (e) => { e.preventDefault(); void zoomReset(); }, { whenInInput: true });
  useEffect(() => { void loadZoom(); void loadSettings(); }, []);

  useEffect(() => {
    const expiredP = listen("auth:session-expired", () => {
      pushToast({
        level: "warn",
        title: "Sesión expirada",
        body: "Inicia sesión de nuevo.",
        action: { label: "Iniciar sesión", onClick: () => navigate("/login") },
        ttl: 12000,
      });
    });
    return () => {
      void expiredP.then((fn) => fn()).catch(() => undefined);
    };
  }, []);

  const currentConnId = Number(searchParams.get("id"));
  const sessionList = Object.values(sessions);

  // Build tab items — Inicio fixed + open sessions (pinned first).
  const tabs = useMemo<SafariTab[]>(() => {
    const list: SafariTab[] = [
      {
        id: DASHBOARD_TAB_ID,
        label: "Inicio",
        icon: <Boxes strokeWidth={1.5} />,
        fixed: true,
      },
    ];
    const sortedSessions = [...sessionList].sort((a, b) => {
      const ap = pinnedIds.has(a.connection.id) ? 1 : 0;
      const bp = pinnedIds.has(b.connection.id) ? 1 : 0;
      return bp - ap;
    });
    for (const s of sortedSessions) {
      const ui = PROVIDER_UI[s.connection.plugin_id];
      list.push({
        id: String(s.connection.id),
        label: s.connection.name,
        color: ui?.color,
        pinned: pinnedIds.has(s.connection.id),
        icon: <ProviderIcon providerId={s.connection.plugin_id} />,
      });
    }
    return list;
  }, [sessionList, pinnedIds]);

  const activeTabId = useMemo(() => {
    if (pathname === "/dashboard" || pathname === "/" || pathname.startsWith("/settings") || pathname.startsWith("/connections") && !currentConnId) {
      return DASHBOARD_TAB_ID;
    }
    if (currentConnId && sessions[currentConnId]) return String(currentConnId);
    return DASHBOARD_TAB_ID;
  }, [pathname, currentConnId, sessions]);

  function onSelectTab(id: string) {
    if (id === DASHBOARD_TAB_ID) {
      navigate("/dashboard");
      return;
    }
    const s = sessions[Number(id)];
    if (s) void openConnection(s.connection);
  }

  function onCloseTab(id: string) {
    const cid = Number(id);
    if (!cid) return;
    if (pinnedIds.has(cid)) return; // pinned tabs are not closed by X
    removeSession(cid);
    setPinnedIds((prev) => {
      const next = new Set(prev);
      next.delete(cid);
      return next;
    });
    if (currentConnId === cid) navigate("/dashboard");
  }

  function togglePin(id: string) {
    const cid = Number(id);
    if (!cid) return;
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      persistPinned(next);
      return next;
    });
  }

  useAppMenuEvents({
    navigate,
    openCommandPalette: () => setPaletteOpen(true),
    toggleSidebar: () => busEmit(APP_EVENT.toggleSidebar),
    newConnection: () => {
      navigate("/connections");
      window.setTimeout(() => busEmit(APP_EVENT.newConnection), 80);
    },
    closeTab: () => {
      if (currentConnId && sessions[currentConnId]) onCloseTab(String(currentConnId));
    },
    jumpTab: (n: number) => {
      const list = Object.values(sessions);
      const target = list[n - 1];
      if (!target) return;
      onSelectTab(String(target.connection.id));
    },
    checkUpdates: async () => {
      try {
        const found = await findUpdate();
        if (found) {
          pushToast({
            level: "info",
            title: `Versión ${found.version} disponible`,
            body: "Hay una nueva versión de Database Manager lista para descargar.",
            ttl: 12000,
            action: { label: "Actualizar", onClick: () => void openReleasePage(found.url) },
          });
        } else {
          pushToast({ level: "success", title: "Estás al día", body: `Versión ${await currentVersion()}` });
        }
      } catch (e) {
        pushToast({ level: "danger", title: "No se pudo comprobar", body: String(e) });
      }
    },
  });

  // Boot update check (gated by settings.notifyUpdates).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = await loadSettings();
      if (!cfg.notifyUpdates) return;
      try {
        const found = await findUpdate();
        if (!found || cancelled) return;
        pushToast({
          level: "info",
          title: `Versión ${found.version} disponible`,
          body: "Hay una nueva versión de Database Manager lista para descargar.",
          ttl: 15000,
          action: { label: "Actualizar", onClick: () => void openReleasePage(found.url) },
        });
      } catch { /* silent on boot */ }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="flex h-screen flex-col text-text">
      {/* Titlebar band — traffic lights (macOS) on the left, tabs middle, toolbar right. */}
      <div
        data-tauri-drag-region
        className="flex h-10 shrink-0 items-stretch border-b border-border-subtle bg-surface"
      >
        <SafariTabsStrip
          items={tabs}
          activeId={activeTabId}
          onSelect={onSelectTab}
          onClose={onCloseTab}
          onContext={(id, x, y) => setCtxMenu({ id, x, y })}
          onNewTab={() => setPaletteOpen(true)}
        />
        <ShellToolbar onCommand={() => setPaletteOpen(true)} />
      </div>

      <section className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <Outlet />
        </div>
        <InspectorPane />
      </section>

      <StatusBar onCommand={() => setPaletteOpen(true)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {ctxMenu && (
        <TabContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)}>
          {ctxMenu.id !== DASHBOARD_TAB_ID && (
            <>
              <button
                type="button"
                onClick={() => {
                  togglePin(ctxMenu.id);
                  setCtxMenu(null);
                }}
                className="block w-full px-3 py-1.5 text-left text-body text-text hover:bg-surface-hover"
              >
                {pinnedIds.has(Number(ctxMenu.id)) ? "Despinear" : "Pinear"}
              </button>
              <button
                type="button"
                onClick={() => {
                  onCloseTab(ctxMenu.id);
                  setCtxMenu(null);
                }}
                className="block w-full px-3 py-1.5 text-left text-body text-text hover:bg-surface-hover"
              >
                Cerrar pestaña
              </button>
              <button
                type="button"
                onClick={() => {
                  for (const s of Object.values(sessions)) {
                    if (String(s.connection.id) !== ctxMenu.id && !pinnedIds.has(s.connection.id)) {
                      removeSession(s.connection.id);
                    }
                  }
                  setCtxMenu(null);
                }}
                className="block w-full px-3 py-1.5 text-left text-body text-text hover:bg-surface-hover"
              >
                Cerrar otras
              </button>
            </>
          )}
        </TabContextMenu>
      )}
    </main>
  );
}
