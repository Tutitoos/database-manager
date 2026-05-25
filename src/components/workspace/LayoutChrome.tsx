import { Plus } from "lucide-react";
import { ProviderIcon } from "@/lib/providers";
import type { Connection } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Standard left-side header for a connection-scoped layout (SQL / Mongo / Redis).
 *  Provider icon + connection name + host:port. Identical across all three.
 */
export function ConnHeaderLeft({ connection }: { connection: Connection | null }) {
  if (!connection) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 h-5 w-5 overflow-hidden rounded-sm border border-border-subtle">
        <ProviderIcon providerId={connection.plugin_id} className="block h-full w-full object-cover" />
      </span>
      <span className="text-h3 font-medium text-text">{connection.name}</span>
      <span className="text-body text-text-muted">
        {connection.host}{connection.port ? `:${connection.port}` : ""}
      </span>
    </div>
  );
}

/** "+" icon button — opens a workspace-tab picker at the mouse position.
 *  Rendered inside the WorkspaceTabsStrip `trailing` slot so it sits next to tabs.
 */
export function NewTabButton({
  onClick,
  className,
}: {
  onClick: (e: React.MouseEvent) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "grid h-7 w-7 place-items-center rounded text-text-faint transition-colors hover:bg-surface-hover hover:text-text",
        className,
      )}
      title="Abrir nueva pestaña"
      aria-label="Nueva pestaña"
    >
      <Plus strokeWidth={1.5} className="h-3.5 w-3.5" />
    </button>
  );
}

/** Standard navigator header: title + count + optional collapse button. */
export function NavigatorHeader({
  title,
  count,
  onCollapse,
}: {
  title: string;
  count?: number;
  onCollapse?: () => void;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border-subtle px-3">
      <span className="text-overline flex-1 text-text-faint">{title}</span>
      {typeof count === "number" && (
        <span className="text-tiny text-text-faint">{count}</span>
      )}
      {onCollapse && (
        <button
          type="button"
          onClick={onCollapse}
          title="Colapsar"
          className="grid h-5 w-5 place-items-center rounded text-text-faint hover:bg-surface-hover hover:text-text"
        >
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 2L4 6l4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

/** Collapsed-rail expand button for navigator. */
export function NavigatorCollapsedRail({ onExpand }: { onExpand: () => void }) {
  return (
    <div className="flex w-9 shrink-0 flex-col items-center gap-1 border-r border-border-subtle bg-surface/40 py-2">
      <button
        type="button"
        onClick={onExpand}
        title="Expandir"
        className="grid h-7 w-7 place-items-center rounded text-text-faint hover:bg-surface-hover hover:text-text"
      >
        <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
