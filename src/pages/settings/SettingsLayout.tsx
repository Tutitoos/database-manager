import { Cloud, Database, Keyboard, KeyRound, Palette, Plug, Server, Settings, UserCircle2 } from "lucide-react";
import { Link, Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useLocation } from "@/lib/router-compat";
import { SideItem } from "@/components/side-item";
import { panel, sectionBorder } from "@/lib/styles";
import { cn } from "@/lib/utils";

export default function SettingsLayout() {
  const { pathname } = useLocation();
  const { t } = useTranslation();

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1", panel)}>
      <aside className={cn("w-56 shrink-0 border-r p-3", panel, sectionBorder)}>
        <Link to="/settings/general">
          <SideItem
            active={pathname === "/settings" || pathname === "/settings/general"}
            icon={<Settings strokeWidth={1.5} className="h-4 w-4" />}
            label={t("settingsLayout.general")}
          />
        </Link>
        <Link to="/settings/appearance">
          <SideItem
            active={pathname.startsWith("/settings/appearance")}
            icon={<Palette strokeWidth={1.5} className="h-4 w-4" />}
            label={t("settingsLayout.appearance")}
          />
        </Link>
        <Link to="/settings/organizations">
          <SideItem
            active={pathname.startsWith("/settings/organizations")}
            icon={<Cloud strokeWidth={1.5} className="h-4 w-4" />}
            label={t("settingsLayout.organizations")}
          />
        </Link>
        <Link to="/settings/local-server">
          <SideItem
            active={pathname.startsWith("/settings/local-server")}
            icon={<Server strokeWidth={1.5} className="h-4 w-4" />}
            label={t("localServer.navLabel")}
          />
        </Link>
        <Link to="/settings/account">
          <SideItem
            active={pathname.startsWith("/settings/account")}
            icon={<UserCircle2 strokeWidth={1.5} className="h-4 w-4" />}
            label={t("settingsLayout.account")}
          />
        </Link>
        <Link to="/settings/connections">
          <SideItem
            active={pathname.startsWith("/settings/connections")}
            icon={<Database strokeWidth={1.5} className="h-4 w-4" />}
            label={t("settingsLayout.connections")}
          />
        </Link>
        <Link to="/settings/credentials">
          <SideItem
            active={pathname.startsWith("/settings/credentials")}
            icon={<KeyRound strokeWidth={1.5} className="h-4 w-4" />}
            label={t("settingsLayout.credentials")}
          />
        </Link>
        <Link to="/settings/plugins">
          <SideItem
            active={pathname.startsWith("/settings/plugins")}
            icon={<Plug strokeWidth={1.5} className="h-4 w-4" />}
            label={t("settingsLayout.plugins")}
          />
        </Link>
        <Link to="/settings/shortcuts">
          <SideItem
            active={pathname.startsWith("/settings/shortcuts")}
            icon={<Keyboard strokeWidth={1.5} className="h-4 w-4" />}
            label={t("settingsLayout.shortcuts")}
          />
        </Link>
      </aside>
      <section className={cn("min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-6", panel)}>
        <Outlet />
      </section>
    </div>
  );
}
