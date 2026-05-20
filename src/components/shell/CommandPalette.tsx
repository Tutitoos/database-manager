import { Boxes, Database, Moon, Plug, Settings, Sun, Table as TableIcon } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/modal";
import { CommandList, type CommandItem } from "@/components/ui/command";
import { useNavigate } from "@/lib/router-compat";
import { setTheme, useAppearance } from "@/lib/theme";
import { useSessionsStore, type Session } from "@/store/sessions";
import { useOpenConnection } from "@/components/connect-gate";

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { sessions } = useSessionsStore();
  const { theme } = useAppearance();
  const openConnection = useOpenConnection();

  const items = useMemo<CommandItem[]>(() => {
    const out: CommandItem[] = [];

    // Navigation
    out.push({
      id: "nav.dashboard",
      label: t("nav.dashboard"),
      group: t("command.group.navigation"),
      icon: <Boxes strokeWidth={1.5} className="h-3.5 w-3.5" />,
      onSelect: () => navigate("/dashboard"),
    });
    out.push({
      id: "nav.connections",
      label: t("nav.connections"),
      group: t("command.group.navigation"),
      icon: <Plug strokeWidth={1.5} className="h-3.5 w-3.5" />,
      onSelect: () => navigate("/connections"),
    });
    out.push({
      id: "nav.settings",
      label: t("nav.settings"),
      group: t("command.group.navigation"),
      icon: <Settings strokeWidth={1.5} className="h-3.5 w-3.5" />,
      onSelect: () => navigate("/settings/general"),
    });

    // Open sessions
    for (const s of Object.values(sessions) as Session[]) {
      out.push({
        id: `conn.${s.connection.id}`,
        label: s.connection.name,
        hint: `${s.connection.host ?? ""}${s.connection.port ? ":" + s.connection.port : ""}`,
        group: t("command.group.connections"),
        icon: <Database strokeWidth={1.5} className="h-3.5 w-3.5" />,
        keywords: [s.connection.plugin_id, s.connection.host ?? ""],
        onSelect: () => {
          void openConnection(s.connection);
        },
      });
    }

    // Actions — non-destructive
    out.push({
      id: "act.theme.toggle",
      label: theme === "dark" ? t("appearance.theme.light") : t("appearance.theme.dark"),
      group: t("command.group.actions"),
      icon: theme === "dark"
        ? <Sun strokeWidth={1.5} className="h-3.5 w-3.5" />
        : <Moon strokeWidth={1.5} className="h-3.5 w-3.5" />,
      onSelect: () => setTheme(theme === "dark" ? "light" : "dark"),
    });
    // Tables from active connection (if any) — TODO once Datos exposes a cache.
    void TableIcon;

    return out;
  }, [sessions, theme, t, navigate, openConnection]);

  if (!open) return null;
  return (
    <Modal onClose={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-lg border border-border-subtle bg-surface-overlay shadow-overlay">
        <CommandList
          items={items}
          placeholder={t("command.placeholder")}
          emptyLabel={t("command.noResults")}
          onClose={onClose}
        />
      </div>
    </Modal>
  );
}
