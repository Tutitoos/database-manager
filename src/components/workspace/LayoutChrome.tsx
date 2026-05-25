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

/** "+ Nueva" pill button — opens a workspace-tab picker at the mouse position.
 *  Rendered inside the WorkspaceTabsStrip `trailing` slot so it sits next to tabs.
 */
export function NewTabButton({
  onClick,
  label = "Nueva",
  className,
}: {
  onClick: (e: React.MouseEvent) => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-6 items-center gap-1 rounded px-2 text-body text-text-faint transition-colors hover:bg-surface-hover hover:text-text",
        className,
      )}
      title="Abrir nueva pestaña"
    >
      <Plus strokeWidth={1.5} className="h-3 w-3" />
      <span>{label}</span>
    </button>
  );
}
