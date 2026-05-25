import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Activity, Database, Hash, KeyRound, Pin, Radio, Table as TableIcon, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { WorkspaceTab } from "@/store/sessions";

/** Render a strip of workspace tabs (entities, queries, channels, views).
 *  Single click selects (and may replace an ephemeral tab elsewhere).
 *  Double click promotes an ephemeral tab to pinned.
 */
export function WorkspaceTabsStrip({
  items,
  activeId,
  onSelect,
  onClose,
  onReorder,
  onPin,
  onContext,
  trailing,
  className,
}: {
  items: WorkspaceTab[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  onReorder?: (orderedIds: string[]) => void;
  onPin?: (id: string) => void;
  onContext?: (id: string, x: number, y: number) => void;
  /** Optional content rendered at the right end of the strip (e.g. a "+" button). */
  trailing?: React.ReactNode;
  className?: string;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((t) => t.id === active.id);
    const newIdx = items.findIndex((t) => t.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = [...items];
    const [m] = next.splice(oldIdx, 1);
    next.splice(newIdx, 0, m);
    onReorder?.(next.map((t) => t.id));
  }

  if (items.length === 0 && !trailing) return null;

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
        <div
          className={cn(
            "flex h-8 min-w-0 items-stretch overflow-x-auto border-b border-border-subtle bg-surface-sunken/40",
            "[&::-webkit-scrollbar]:h-0",
            className,
          )}
        >
          {items.map((t, i) => (
            <WorkspaceTabItem
              key={t.id}
              tab={t}
              active={activeId === t.id}
              prevActive={i > 0 && activeId === items[i - 1]?.id}
              onSelect={onSelect}
              onClose={onClose}
              onPin={onPin}
              onContext={onContext}
            />
          ))}
          {trailing && (
            <div className="ml-auto flex shrink-0 items-center pr-1.5 pl-2">
              {trailing}
            </div>
          )}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function TabIcon({ tab }: { tab: WorkspaceTab }) {
  const cls = "h-3 w-3 shrink-0";
  if (tab.kind === "entity") {
    if (tab.entityKind === "table") return <TableIcon strokeWidth={1.5} className={cn(cls, "text-sky-400")} />;
    if (tab.entityKind === "collection") return <Database strokeWidth={1.5} className={cn(cls, "text-emerald-400")} />;
    return <KeyRound strokeWidth={1.5} className={cn(cls, "text-violet-400")} />;
  }
  if (tab.kind === "query") return <Hash strokeWidth={1.5} className={cn(cls, "text-amber-400")} />;
  if (tab.kind === "channel") return <Radio strokeWidth={1.5} className={cn(cls, "text-pink-400")} />;
  if (tab.kind === "view") {
    if (tab.view === "metrics") return <Activity strokeWidth={1.5} className={cn(cls, "text-sky-400")} />;
    return <Database strokeWidth={1.5} className={cn(cls, "text-text-faint")} />;
  }
  return <Database strokeWidth={1.5} className={cn(cls, "text-text-faint")} />;
}

function WorkspaceTabItem({
  tab,
  active,
  prevActive,
  onSelect,
  onClose,
  onPin,
  onContext,
}: {
  tab: WorkspaceTab;
  active: boolean;
  prevActive: boolean;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  onPin?: (id: string) => void;
  onContext?: (id: string, x: number, y: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(tab.id)}
      onDoubleClick={() => {
        if (tab.ephemeral) onPin?.(tab.id);
      }}
      onContextMenu={(e) => {
        if (!onContext) return;
        e.preventDefault();
        onContext(tab.id, e.clientX, e.clientY);
      }}
      className={cn(
        "group/wtab relative flex h-full max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 px-3 text-body transition-colors",
        // 1-px divider between non-active tabs (skipped right after the active one)
        !active && !prevActive && "border-l border-border-subtle/50",
        active
          ? "bg-surface text-text"
          : "text-text-muted hover:bg-surface-hover hover:text-text",
      )}
      title={tab.title}
    >
      {/* Bottom accent stripe for active tab */}
      {active && (
        <span
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-accent"
          aria-hidden
        />
      )}
      {tab.pinned ? (
        <Pin strokeWidth={1.5} className="h-3 w-3 shrink-0 -rotate-45 text-accent/80" aria-label="pinned" />
      ) : (
        <TabIcon tab={tab} />
      )}
      <span
        className={cn(
          "truncate",
          tab.ephemeral && "italic text-text-muted",
        )}
      >
        {tab.title}
      </span>
      {onClose && !tab.pinned && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
          className={cn(
            "ml-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-sm text-text-faint transition-all hover:bg-surface-hover hover:text-text",
            active ? "opacity-70 hover:opacity-100" : "opacity-0 group-hover/wtab:opacity-100",
          )}
          aria-label="close"
        >
          <X strokeWidth={1.5} className="h-3 w-3" />
        </button>
      )}
      {onClose && tab.pinned && (
        // Pinned: clicking the pin again unpins (caller handles), close button hidden.
        <span className="ml-0.5 h-4 w-4" aria-hidden />
      )}
    </div>
  );
}

/** Floating context menu for workspace tabs. */
export function WorkspaceTabContextMenu({
  x,
  y,
  onClose,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(true);
  if (!mounted) return null;
  return (
    <div
      onClick={() => {
        setMounted(false);
        onClose();
      }}
      style={{ position: "fixed", inset: 0, zIndex: 200 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: "fixed", left: x, top: y }}
        className="min-w-[11rem] overflow-hidden rounded-md border border-border-subtle bg-surface-overlay py-1 shadow-lg"
      >
        {children}
      </div>
    </div>
  );
}

/** Standard menu item used inside WorkspaceTabContextMenu. */
export function WorkspaceMenuItem({
  icon,
  label,
  shortcut,
  onClick,
  danger,
}: {
  icon?: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-body transition-colors",
        danger
          ? "text-red-300 hover:bg-red-500/10 hover:text-red-200"
          : "text-text-muted hover:bg-surface-hover hover:text-text",
      )}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="flex-1 truncate">{label}</span>
      {shortcut && (
        <span className="shrink-0 text-tiny text-text-faint">{shortcut}</span>
      )}
    </button>
  );
}
