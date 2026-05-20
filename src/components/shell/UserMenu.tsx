import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, LogIn, LogOut, UserCircle2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { signOut as authSignOut, currentUser } from "@/lib/auth";
import type { AppUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useActiveOrgAccent } from "@/lib/use-active-org-accent";
import { useOrgs } from "@/store/orgs";

export function UserMenu() {
  const { t } = useTranslation();
  const [user, setUser] = useState<AppUser | null>(null);
  const accent = useActiveOrgAccent();
  const { orgs, activeId } = useOrgs();
  const isLocalOrg = orgs.find((o) => o.id === activeId)?.server_kind === "local";

  useEffect(() => {
    const load = () => { currentUser().then(setUser).catch(() => setUser(null)); };
    load();
    // The active user is tied to the active org now (one OAuth identity per
    // remote, plus the synthetic local). Refetch whenever the org switches so
    // the chip in the sidebar matches what the rest of the UI talks to.
    const onOrg = () => load();
    window.addEventListener("app:org-changed", onOrg);
    return () => window.removeEventListener("app:org-changed", onOrg);
  }, []);

  if (!user) {
    return (
      <Link
        to="/login"
        className="flex items-center gap-2 rounded-md p-2 text-body text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
      >
        <LogIn strokeWidth={1.5} className="h-4 w-4" />
        Iniciar sesión para sync
      </Link>
    );
  }

  const initials = (user.name ?? user.email).trim().slice(0, 2).toUpperCase();

  return (
    <Dropdown
      align="start"
      direction="up"
      triggerClassName="w-full"
      className="w-full"
      trigger={
        <span
          className={cn(
            "flex w-full items-center gap-2 rounded-md p-2 text-body text-text transition-colors hover:bg-surface-hover",
          )}
        >
          {user.avatar_url ? (
            <img src={user.avatar_url} alt="" className="h-6 w-6 shrink-0 rounded-full" />
          ) : (
            <span
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-text-on-accent"
              style={{ background: accent }}
            >
              {initials}
            </span>
          )}
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-text">{user.name ?? user.email}</p>
            {user.name && <p className="truncate text-[10px] text-text-faint">{user.email}</p>}
          </div>
          <ChevronDown strokeWidth={1.5} className="h-3 w-3 text-text-faint" />
        </span>
      }
    >
      {(close) => (
        <div className="w-full">
          <Link to="/settings/account" onClick={close}>
            <DropdownItem icon={<UserCircle2 strokeWidth={1.5} className="h-3.5 w-3.5" />}>
              {t("nav.settings")}
            </DropdownItem>
          </Link>
          {!isLocalOrg && (
            <>
              <DropdownSeparator />
              <DropdownItem
                danger
                icon={<LogOut strokeWidth={1.5} className="h-3.5 w-3.5" />}
                onClick={async () => {
                  close();
                  await authSignOut().catch(() => undefined);
                  await invoke<unknown>("auth_current_user").catch(() => undefined);
                  setUser(null);
                }}
              >
                Cerrar sesión
              </DropdownItem>
            </>
          )}
        </div>
      )}
    </Dropdown>
  );
}
