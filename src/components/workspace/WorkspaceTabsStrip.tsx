import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Database, Hash, KeyRound, Radio, Table as TableIcon, X } from "lucide-react";
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
  className,
}: {
  items: WorkspaceTab[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  onReorder?: (orderedIds: string[]) => void;
  onPin?: (id: string) => void;
  onContext?: (id: string, x: number, y: number) => void;
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

  if (items.length === 0) return null;

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
        <div
          className={cn(
            "flex h-7 min-w-0 items-stretch gap-px overflow-x-auto border-b border-border-subtle bg-surface-sunken/50 px-1",
            "[&::-webkit-scrollbar]:h-0",
            className,
          )}
        >
          {items.map((t) => (
            <WorkspaceTabItem
              key={t.id}
              tab={t}
              active={activeId === t.id}
              onSelect={onSelect}
              onClose={onClose}
              onPin={onPin}
              onContext={onContext}
            />
          ))}
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
  return <Database strokeWidth={1.5} className={cn(cls, "text-text-faint")} />;
}

function WorkspaceTabItem({
  tab,
  active,
  onSelect,
  onClose,
  onPin,
  onContext,
}: {
  tab: WorkspaceTab;
  active: boolean;
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
        "group/wtab flex h-6 max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 self-center rounded-md px-2 text-body transition-colors",
        active
          ? "bg-surface-elevated text-text"
          : "text-text-muted hover:bg-surface-hover hover:text-text",
        tab.ephemeral && "italic opacity-80",
      )}
      title={tab.title}
    >
      <TabIcon tab={tab} />
      <span className="truncate">{tab.title}</span>
      {tab.pinned && (
        <span className="ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/60" aria-hidden />
      )}
      {onClose && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
          className="ml-0.5 hidden rounded-sm p-0.5 text-text-faint transition-colors hover:bg-surface-hover hover:text-text group-hover/wtab:block"
          aria-label="close"
        >
          <X strokeWidth={1.5} className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/** Floating context menu for workspace tabs. Same pattern as TabContextMenu in SafariTabsStrip. */
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
        className="min-w-[10rem] overflow-hidden rounded-md border border-border-subtle bg-surface-overlay shadow-md"
      >
        {children}
      </div>
    </div>
  );
}
