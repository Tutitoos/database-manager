import { Boxes, Plug, Settings } from "lucide-react";
import { Link, Outlet, useLocation } from "react-router";
import { IconButton } from "@/components/icon-button";
import { appBg, panel, sectionBorder, surface } from "@/lib/styles";
import { cn } from "@/lib/utils";

export default function AppLayout() {
  const { pathname } = useLocation();

  return (
    <main className={cn("flex h-screen text-zinc-100", appBg)}>
      <section className={cn("flex h-screen w-full overflow-hidden", surface)}>
        <aside className={cn("flex w-20 flex-col items-center border-r", panel, sectionBorder)}>
          <div className="mt-4 grid h-9 w-9 place-items-center rounded-md border border-zinc-700/70 bg-[#101010] text-zinc-100">
            <Boxes className="h-5 w-5" />
          </div>
          <nav className="mt-6 flex w-full flex-1 flex-col gap-2 px-2">
            <Link to="/connections">
              <IconButton active={pathname.startsWith("/connections")} label="Conexiones" showLabel>
                <Plug className="h-5 w-5" />
              </IconButton>
            </Link>
            <Link to="/settings">
              <IconButton active={pathname.startsWith("/settings")} label="Ajustes" showLabel>
                <Settings className="h-5 w-5" />
              </IconButton>
            </Link>
          </nav>
        </aside>
        <Outlet />
      </section>
    </main>
  );
}
