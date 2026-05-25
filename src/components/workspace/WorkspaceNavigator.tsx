import { ChevronLeft, ChevronRight, RefreshCw, Search, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export interface NavItem {
  /** Stable id used for the active highlight (e.g. `entity:table:public:users`). */
  id: string;
  label: string;
  /** Optional secondary label rendered muted (e.g. db name, type). */
  meta?: string;
  /** Optional icon node (lucide icon already sized). */
  icon?: React.ReactNode;
  /** Optional grouping bucket — items with the same group render under a header. */
  group?: string;
  /** Free-form data the caller may need on open/pin. */
  data?: unknown;
}

/** Collapsible left navigator shared by all three layouts.
 *  Renders a flat or grouped list, highlights the active tab, supports
 *  single-click (ephemeral open) and double-click (pin open).
 */
export function WorkspaceNavigator({
  items,
  activeItemId,
  onOpen,
  onPin,
  onRefresh,
  loading,
  header,
  emptyText,
  searchValue,
  onSearchChange,
  collapsed,
  onCollapsedChange,
  width = 240,
  collapsedWidth = 36,
  toolbar,
}: {
  items: NavItem[];
  activeItemId?: string | null;
  onOpen: (item: NavItem) => void;
  onPin?: (item: NavItem) => void;
  onRefresh?: () => void;
  loading?: boolean;
  header?: React.ReactNode;
  emptyText?: string;
  searchValue?: string;
  onSearchChange?: (v: string) => void;
  collapsed?: boolean;
  onCollapsedChange?: (next: boolean) => void;
  width?: number;
  collapsedWidth?: number;
  toolbar?: React.ReactNode;
}) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isCollapsed = collapsed ?? internalCollapsed;
  const setCollapsed = onCollapsedChange ?? setInternalCollapsed;

  if (isCollapsed) {
    return (
      <div
        className="flex shrink-0 flex-col items-center gap-1 border-r border-border-subtle bg-surface/40 py-2"
        style={{ width: collapsedWidth }}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Expand navigator"
          className="grid h-7 w-7 place-items-center rounded text-text-faint hover:bg-surface-hover hover:text-text"
        >
          <ChevronRight strokeWidth={1.5} className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const grouped = groupItems(items);

  return (
    <div
      className="flex shrink-0 flex-col border-r border-border-subtle bg-surface/40"
      style={{ width }}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border-subtle px-2">
        {header && <div className="min-w-0 flex-1">{header}</div>}
        {!header && <div className="min-w-0 flex-1" />}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="grid h-6 w-6 place-items-center rounded text-text-faint transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw strokeWidth={1.5} className={cn("h-3 w-3", loading && "animate-spin")} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="Collapse navigator"
          className="grid h-6 w-6 place-items-center rounded text-text-faint hover:bg-surface-hover hover:text-text"
        >
          <ChevronLeft strokeWidth={1.5} className="h-3.5 w-3.5" />
        </button>
      </div>

      {onSearchChange && (
        <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border-subtle px-2">
          <Search strokeWidth={1.5} className="h-3 w-3 shrink-0 text-text-faint" />
          <input
            value={searchValue ?? ""}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search…"
            className="min-w-0 flex-1 bg-transparent text-body text-text placeholder:text-text-faint outline-none"
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="text-text-faint transition-colors hover:text-text"
              aria-label="clear"
            >
              <X strokeWidth={1.5} className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {toolbar && (
        <div className="flex shrink-0 items-center gap-1 border-b border-border-subtle px-2 py-1">
          {toolbar}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {items.length === 0 ? (
          <div className="px-3 py-4 text-center text-body text-text-faint">
            {emptyText ?? "Empty"}
          </div>
        ) : (
          grouped.map(([group, list]) => (
            <div key={group ?? "__"} className="pb-1">
              {group && (
                <p className="text-overline px-3 pb-0.5 pt-2 text-text-faint">{group}</p>
              )}
              {list.map((it) => {
                const isActive = it.id === activeItemId;
                return (
                  <div key={it.id} className="px-1">
                    <button
                      type="button"
                      onClick={() => onOpen(it)}
                      onDoubleClick={() => onPin?.(it)}
                      className={cn(
                        "text-body group/navrow flex h-6 w-full items-center gap-1.5 rounded px-1.5 text-left transition-colors",
                        isActive
                          ? "bg-accent-soft text-accent"
                          : "text-text-muted hover:bg-surface-hover hover:text-text",
                      )}
                    >
                      {it.icon && <span className="shrink-0">{it.icon}</span>}
                      <span className="min-w-0 flex-1 truncate font-mono">{it.label}</span>
                      {it.meta && (
                        <span className="shrink-0 text-tiny text-text-faint">{it.meta}</span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function groupItems(items: NavItem[]): [string | undefined, NavItem[]][] {
  if (items.every((it) => !it.group)) return [[undefined, items]];
  const map = new Map<string | undefined, NavItem[]>();
  for (const it of items) {
    const k = it.group;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(it);
  }
  return [...map.entries()];
}
