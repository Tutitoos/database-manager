import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, ChevronRight, Folder, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "@/lib/router-compat";
import { ProviderIcon, PROVIDER_UI } from "@/lib/providers";
import type { Connection, ConnectionGroup } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { UserMenu } from "@/components/shell/UserMenu";
import { OrgSwitcher } from "@/components/shell/OrgSwitcher";
import { useOpenConnection } from "@/components/connect-gate";

export function Sidebar() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const currentId = Number(searchParams.get("id"));
  const { showSidebarBadges } = useSettings();
  const openConnection = useOpenConnection();

  const [connections, setConnections] = useState<Connection[]>([]);
  const [groups, setGroups] = useState<ConnectionGroup[]>([]);
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<number | null>>(new Set([null]));

  // Load connections + groups whenever active org changes.
  useEffect(() => {
    const load = () => {
      invoke<Connection[]>("list_connections").then(setConnections).catch(() => setConnections([]));
      invoke<ConnectionGroup[]>("list_groups").then(setGroups).catch(() => setGroups([]));
    };
    load();
    const handler = () => load();
    window.addEventListener("app:org-changed", handler);
    return () => window.removeEventListener("app:org-changed", handler);
  }, []);

  // Load favorites from settings.
  useEffect(() => {
    invoke<string | null>("get_app_setting", { key: "app.favorites" })
      .then((raw) => {
        if (!raw) return;
        try {
          const ids = JSON.parse(raw) as number[];
          setFavorites(new Set(Array.isArray(ids) ? ids : []));
        } catch {
          /* ignore */
        }
      })
      .catch(() => undefined);
  }, []);

  // Persist favorites.
  const persistFavorites = useCallback((next: Set<number>) => {
    void invoke("set_app_setting", {
      key: "app.favorites",
      valueJson: JSON.stringify([...next]),
    }).catch(() => undefined);
  }, []);

  function toggleFavorite(id: number) {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistFavorites(next);
      return next;
    });
  }

  const favoriteList = useMemo(
    () => connections.filter((c) => favorites.has(c.id)),
    [connections, favorites],
  );

  const byGroup = useMemo(() => {
    const map = new Map<number | null, Connection[]>();
    for (const c of connections) {
      const gid = c.group_id ?? null;
      if (!map.has(gid)) map.set(gid, []);
      map.get(gid)!.push(c);
    }
    return map;
  }, [connections]);

  function toggleWorkspace(gid: number | null) {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border-subtle bg-surface text-text">
      <OrgSwitcher />
      <div className="flex-1 overflow-y-auto isolate">
        {favoriteList.length > 0 && (
          <Section title={t("sidebar.favorites")} icon={<Star strokeWidth={1.5} className="h-3 w-3" />}>
            {favoriteList.map((c) => (
              <ConnRow
                key={c.id}
                connection={c}
                active={currentId === c.id}
                favorite
                onClick={() => openConnection(c)}
                onToggleFavorite={() => toggleFavorite(c.id)}
              />
            ))}
          </Section>
        )}

        <Section title={t("sidebar.workspaces")} icon={<Folder strokeWidth={1.5} className="h-3 w-3" />}>
          {[{ id: null, name: t("shell.sidebarNoFolder") } as { id: number | null; name: string }, ...groups]
            .map((g) => {
              const list = byGroup.get(g.id) ?? [];
              const expanded = expandedWorkspaces.has(g.id);
              if (list.length === 0 && g.id !== null) return null;
              // The implicit "Sin carpeta" bucket renders rows flat without a header.
              if (g.id === null) {
                return (
                  <div key="ungrouped">
                    {list.map((c) => (
                      <ConnRow
                        key={c.id}
                        connection={c}
                        active={currentId === c.id}
                        favorite={favorites.has(c.id)}
                        onClick={() => openConnection(c)}
                        onToggleFavorite={() => toggleFavorite(c.id)}
                      />
                    ))}
                  </div>
                );
              }
              return (
                <div key={String(g.id)}>
                  <div className="px-1.5">
                    <button
                      type="button"
                      onClick={() => toggleWorkspace(g.id)}
                      className="text-overline flex h-5 w-full items-center gap-1.5 rounded-sm px-1 text-left transition-colors hover:bg-surface-hover hover:text-text-muted"
                    >
                      {expanded ? (
                        <ChevronDown strokeWidth={1.5} className="h-2.5 w-2.5 shrink-0" />
                      ) : (
                        <ChevronRight strokeWidth={1.5} className="h-2.5 w-2.5 shrink-0" />
                      )}
                      <span className="truncate">{g.name}</span>
                      {showSidebarBadges && <span className="ml-auto">{list.length}</span>}
                    </button>
                  </div>
                  {expanded &&
                    list.map((c) => (
                      <ConnRow
                        key={c.id}
                        connection={c}
                        active={currentId === c.id}
                        favorite={favorites.has(c.id)}
                        onClick={() => openConnection(c)}
                        onToggleFavorite={() => toggleFavorite(c.id)}
                        indented
                      />
                    ))}
                </div>
              );
            })}
        </Section>
      </div>

      <div className="shrink-0 border-t border-border-subtle p-1">
        <UserMenu />
      </div>
    </aside>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="pb-1">
      <p className="text-overline sticky top-0 z-10 bg-surface/95 px-3 pt-3 pb-1.5 backdrop-blur-sm">
        {title}
      </p>
      {children}
    </div>
  );
}

function ConnRow({
  connection,
  active,
  favorite,
  onClick,
  onToggleFavorite,
  indented,
}: {
  connection: Connection;
  active: boolean;
  favorite: boolean;
  onClick: () => void;
  onToggleFavorite: () => void;
  indented?: boolean;
}) {
  const ui = PROVIDER_UI[connection.plugin_id];
  const color = ui?.color ?? "var(--accent)";
  return (
    <div className={cn("px-1.5", indented && "pl-6")}>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className={cn(
          "text-body group/row flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left leading-none transition-colors",
          active
            ? "bg-accent-soft text-text"
            : "text-text-muted hover:bg-surface-hover hover:text-text",
        )}
      >
        <span
          className="grid h-3.5 w-3.5 shrink-0 place-items-center overflow-hidden rounded-[3px]"
          style={{ background: `color-mix(in srgb, ${color} 22%, transparent)` }}
        >
          <ProviderIcon providerId={connection.plugin_id} className="block h-full w-full object-cover" />
        </span>
        <span className="min-w-0 flex-1 truncate">{connection.name}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className={cn(
            "shrink-0 rounded-sm p-0.5 transition-colors",
            favorite
              ? "text-warn"
              : "text-text-faint opacity-0 group-hover/row:opacity-100 hover:text-warn",
          )}
          title={favorite ? "Quitar de favoritas" : "Marcar favorita"}
        >
          <Star strokeWidth={favorite ? 0 : 1.5} fill={favorite ? "currentColor" : "none"} className="h-2.5 w-2.5" />
        </button>
      </div>
    </div>
  );
}
