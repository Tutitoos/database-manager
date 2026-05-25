import { Activity, Database, Hash, KeyRound, Plus, Radio, Table as TableIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Session, WorkspaceTab } from "@/store/sessions";

/** Empty state for the workspace: shown when a session has no open tabs.
 *  Surfaces recents + quick-open actions per session type.
 */
export function WelcomeScreen({
  session,
  onOpenRecent,
  onAction,
}: {
  session: Session;
  onOpenRecent?: (tab: WorkspaceTab) => void;
  onAction?: (action: WelcomeAction) => void;
}) {
  const recents = (session.recents ?? []).slice(0, 12);
  const actions = actionsFor(session);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-surface/40 px-8 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-heading mb-1 text-text">{session.connection.name}</h1>
        <p className="text-body mb-6 text-text-muted">
          {labelFor(session.type)} workspace. Open an entity from the navigator or start with one of the actions below.
        </p>

        <section className="mb-8">
          <h2 className="text-overline mb-2 text-text-faint">Open new</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {actions.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onAction?.(a)}
                className="group/welcomecard flex items-center gap-3 rounded-md border border-border-subtle bg-surface-elevated p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-hover"
              >
                <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded", a.iconBg)}>
                  {a.icon}
                </span>
                <span className="min-w-0">
                  <span className="text-body block font-medium text-text">{a.label}</span>
                  {a.description && (
                    <span className="text-tiny block text-text-faint">{a.description}</span>
                  )}
                </span>
                <Plus strokeWidth={1.5} className="ml-auto h-3.5 w-3.5 shrink-0 text-text-faint" />
              </button>
            ))}
          </div>
        </section>

        {recents.length > 0 && (
          <section>
            <h2 className="text-overline mb-2 text-text-faint">Recently viewed</h2>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {recents.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onOpenRecent?.(t)}
                  className="text-body flex items-center gap-2 rounded-md border border-border-subtle bg-surface px-2.5 py-1.5 text-left text-text-muted transition-colors hover:border-border-strong hover:text-text"
                >
                  <RecentIcon tab={t} />
                  <span className="min-w-0 flex-1 truncate font-mono">{t.title}</span>
                  <span className="text-tiny text-text-faint">{kindLabel(t)}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export interface WelcomeAction {
  id: string;
  label: string;
  description?: string;
  kind: "new-query" | "open-metrics" | "open-schema" | "subscribe-channel";
  icon: React.ReactNode;
  iconBg: string;
}

function actionsFor(session: Session): WelcomeAction[] {
  const out: WelcomeAction[] = [];
  if (session.type === "sql") {
    out.push({
      id: "sql-new-query",
      label: "New query",
      description: "Open a blank SQL editor",
      kind: "new-query",
      icon: <Hash strokeWidth={1.5} className="h-4 w-4 text-amber-300" />,
      iconBg: "bg-amber-500/15",
    });
  }
  if (session.type === "redis") {
    out.push({
      id: "redis-subscribe",
      label: "Subscribe to channel",
      description: "Open a new Pub/Sub channel tab",
      kind: "subscribe-channel",
      icon: <Radio strokeWidth={1.5} className="h-4 w-4 text-pink-300" />,
      iconBg: "bg-pink-500/15",
    });
  }
  out.push({
    id: "open-metrics",
    label: "Open metrics",
    description: "Server-level metrics panel",
    kind: "open-metrics",
    icon: <Activity strokeWidth={1.5} className="h-4 w-4 text-sky-300" />,
    iconBg: "bg-sky-500/15",
  });
  return out;
}

function RecentIcon({ tab }: { tab: WorkspaceTab }) {
  const cls = "h-3 w-3 shrink-0";
  if (tab.kind === "entity") {
    if (tab.entityKind === "table") return <TableIcon strokeWidth={1.5} className={cn(cls, "text-sky-400")} />;
    if (tab.entityKind === "collection") return <Database strokeWidth={1.5} className={cn(cls, "text-emerald-400")} />;
    return <KeyRound strokeWidth={1.5} className={cn(cls, "text-violet-400")} />;
  }
  if (tab.kind === "query") return <Hash strokeWidth={1.5} className={cn(cls, "text-amber-400")} />;
  if (tab.kind === "channel") return <Radio strokeWidth={1.5} className={cn(cls, "text-pink-400")} />;
  return <Activity strokeWidth={1.5} className={cn(cls, "text-text-faint")} />;
}

function kindLabel(t: WorkspaceTab): string {
  if (t.kind === "entity") return t.entityKind;
  return t.kind;
}

function labelFor(type: Session["type"]): string {
  if (type === "sql") return "SQL";
  if (type === "document") return "MongoDB";
  return "Redis";
}
