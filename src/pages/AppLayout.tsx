import { invoke } from "@tauri-apps/api/core";
import { Boxes, Plug, Settings, X } from "lucide-react";
import { Link, Outlet } from "@tanstack/react-router";
import { useLocation, useNavigate, useSearchParams } from "@/lib/router-compat";
import { useEffect } from "react";
import { IconButton } from "@/components/icon-button";
import { ProviderIcon } from "@/lib/providers";
import { appBg, panel, sectionBorder, surface } from "@/lib/styles";
import { cn } from "@/lib/utils";
import { useSessionsStore, sessionRoute, type Session } from "@/store/sessions";


function SessionItem({ session, active, onClose }: { session: Session; active: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="group relative w-full">
      <button
        onClick={() => navigate(sessionRoute(session))}
        title={session.connection.name}
        className={cn(
          "flex w-full flex-col items-center gap-1 overflow-hidden rounded-md border px-1 py-2 transition-colors",
          active
            ? "border-zinc-700 bg-zinc-900 text-white"
            : "border-transparent text-zinc-400 hover:border-zinc-700/70 hover:bg-zinc-900 hover:text-zinc-100"
        )}
      >
        <span className="h-7 w-7 overflow-hidden rounded">
          <ProviderIcon providerId={session.connection.plugin_id} className="block h-full w-full object-cover" />
        </span>
        <span className={cn("max-w-full truncate text-[10px] font-medium leading-none", active ? "text-white" : "text-zinc-500")}>
          {session.connection.name}
        </span>
      </button>
      <button
        onClick={onClose}
        className="absolute right-0.5 top-0.5 hidden rounded p-0.5 text-zinc-600 hover:text-red-400 group-hover:block"
        title="Cerrar sesión"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

export default function AppLayout() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { sessions, removeSession } = useSessionsStore();

  useEffect(() => {
    invoke<string | null>("load_sessions").then((json) => {
      try {
        const data = json ? (JSON.parse(json) as Record<number, Session>) : {};
        useSessionsStore.getState().hydrate(data);
      } catch {
        useSessionsStore.getState().hydrate({});
      }
    }).catch(() => {
      useSessionsStore.getState().hydrate({});
    });
  }, []);
  const currentId = Number(searchParams.get("id"));

  const sessionList = Object.values(sessions);

  function handleClose(connectionId: number) {
    removeSession(connectionId);
    if (currentId === connectionId) navigate("/connections");
  }

  return (
    <main className={cn("flex h-screen text-zinc-100", appBg)}>
      <section className={cn("flex h-screen w-full overflow-hidden", surface)}>
        <aside className={cn("flex w-20 flex-col items-center border-r", panel, sectionBorder)}>
          <div className="mt-4 grid h-9 w-9 place-items-center rounded-md border border-zinc-700/70 bg-[#101010] text-zinc-100">
            <Boxes className="h-5 w-5" />
          </div>

          <nav className="mt-6 flex w-full flex-1 flex-col px-2 overflow-y-auto">
            <Link to="/connections">
              <IconButton active={pathname.startsWith("/connections")} label="Conexiones" showLabel>
                <Plug className="h-5 w-5" />
              </IconButton>
            </Link>

            {sessionList.length > 0 && (
              <div className="mt-1.5 flex flex-col gap-1">
                <div className="mx-1 border-t border-zinc-800" />
                {sessionList.map((session) => (
                  <SessionItem
                    key={session.connection.id}
                    session={session}
                    active={currentId === session.connection.id}
                    onClose={() => handleClose(session.connection.id)}
                  />
                ))}
                <div className="mx-1 border-t border-zinc-800" />
              </div>
            )}

            <div className="mt-2">
              <Link to="/settings">
                <IconButton active={pathname.startsWith("/settings")} label="Ajustes" showLabel>
                  <Settings className="h-5 w-5" />
                </IconButton>
              </Link>
            </div>
          </nav>
        </aside>
        <Outlet />
      </section>
    </main>
  );
}
