import { Plug, Settings } from "lucide-react";
import { Link, Outlet, useLocation } from "react-router";
import { SideItem } from "@/components/side-item";
import { panel, sectionBorder } from "@/lib/styles";
import { cn } from "@/lib/utils";

export default function SettingsLayout() {
  const { pathname } = useLocation();

  return (
    <div className={cn("flex min-w-0 flex-1", panel)}>
      <aside className={cn("w-48 shrink-0 border-r p-3", panel, sectionBorder)}>
        <Link to="/settings/general">
          <SideItem
            active={pathname === "/settings" || pathname === "/settings/general"}
            icon={<Settings className="h-4 w-4" />}
            label="General"
          />
        </Link>
        <Link to="/settings/plugins">
          <SideItem
            active={pathname.startsWith("/settings/plugins")}
            icon={<Plug className="h-4 w-4" />}
            label="Plugins"
          />
        </Link>
      </aside>
      <section className={cn("min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-6", panel)}>
        <Outlet />
      </section>
    </div>
  );
}
