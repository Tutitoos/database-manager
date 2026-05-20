import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useEffect } from "react";
import { useNavigate } from "@/lib/router-compat";
import { setAccent, setDensity, setTheme, type Accent, type Density, type ThemeMode } from "@/lib/theme";
import { zoomIn, zoomOut, zoomReset } from "@/lib/zoom";

export type MenuHandler = (id: string) => void;

interface MenuActions {
  navigate: ReturnType<typeof useNavigate>;
  openCommandPalette: () => void;
  toggleSidebar: () => void;
  newConnection: () => void;
  closeTab: () => void;
  jumpTab: (n: number) => void;
  checkUpdates: () => void;
}

export function useAppMenuEvents(actions: MenuActions) {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    listen<string>("menu", (event) => {
      handle(event.payload, actions);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function handle(id: string, a: MenuActions) {
  // App
  if (id === "app.settings") return void a.navigate("/settings/general");
  if (id === "help.shortcuts") return void a.navigate("/settings/shortcuts");
  if (id === "app.check_updates") return void a.checkUpdates();

  // File
  if (id === "file.new_connection") return void a.newConnection();
  if (id === "file.connections") return void a.navigate("/connections");
  if (id === "file.export_connections") return void emitNotImplemented("Exportar conexiones");
  if (id === "file.import_connections") return void emitNotImplemented("Importar conexiones");
  if (id === "file.close_tab") return void a.closeTab();

  // Edit
  if (id === "edit.find") return void a.openCommandPalette();

  // View
  if (id === "view.dashboard") return void a.navigate("/dashboard");
  if (id === "view.connections") return void a.navigate("/connections");
  if (id === "view.toggle_sidebar") return void a.toggleSidebar();
  if (id === "view.zoom_in") return void zoomIn();
  if (id === "view.zoom_out") return void zoomOut();
  if (id === "view.zoom_reset") return void zoomReset();
  if (id.startsWith("view.theme.")) {
    const theme = id.slice("view.theme.".length) as ThemeMode;
    return void setTheme(theme);
  }
  if (id.startsWith("view.accent.")) {
    const accent = id.slice("view.accent.".length) as Accent;
    return void setAccent(accent);
  }
  if (id.startsWith("view.density.")) {
    const density = id.slice("view.density.".length) as Density;
    return void setDensity(density);
  }

  // Window
  if (id.startsWith("window.tab.")) {
    const n = Number(id.slice("window.tab.".length));
    if (!Number.isNaN(n)) return void a.jumpTab(n);
  }

  // Help
  if (id === "help.docs") return void openExternal("https://github.com/Tutitoos/database-manager#readme").catch(() => undefined);
  if (id === "help.github") return void openExternal("https://github.com/Tutitoos/database-manager").catch(() => undefined);
  if (id === "help.report")
    return void openExternal(reportUrl()).catch(() => undefined);
}

function reportUrl(): string {
  const body = `SO: ${navigator.platform}\n\nDescripción:`;
  return `https://github.com/Tutitoos/database-manager/issues/new?title=Bug:%20&body=${encodeURIComponent(body)}`;
}

function emitNotImplemented(label: string) {
  // Lazy import to avoid circular dep with ToastProvider.
  void import("@/components/ui/toast").then(({ pushToast }) => {
    pushToast({ level: "info", title: label, body: "Próximamente." });
  });
}
