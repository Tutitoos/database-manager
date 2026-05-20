import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export interface SafariTab {
  id: string;
  label: string;
  /** Tiny icon (provider) shown left of label. */
  icon?: React.ReactNode;
  /** Subtle color stripe at left edge. */
  color?: string;
  pinned?: boolean;
  /** Non-closable, non-draggable (e.g. Inicio). */
  fixed?: boolean;
}

export function SafariTabsStrip({
  items,
  activeId,
  onSelect,
  onClose,
  onReorder,
  onContext,
  onNewTab,
  className,
  /** Reserve space for macOS traffic lights on the left. */
  reserveTrafficLights = true,
}: {
  items: SafariTab[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  onReorder?: (orderedIds: string[]) => void;
  onContext?: (id: string, x: number, y: number) => void;
  onNewTab?: () => void;
  className?: string;
  reserveTrafficLights?: boolean;
}) {
  const { t } = useTranslation();
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

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
        <div
          data-tauri-drag-region
          className={cn(
            "flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto",
            "[&::-webkit-scrollbar]:h-0",
            className,
          )}
          style={{ paddingLeft: reserveTrafficLights ? 80 : 8 }}
        >
          {items.map((t) => (
            <SafariTab
              key={t.id}
              tab={t}
              active={activeId === t.id}
              onSelect={onSelect}
              onClose={onClose}
              onContext={onContext}
            />
          ))}
          {onNewTab && (
            <button
              type="button"
              onClick={onNewTab}
              title={t("shell.newTab")}
              data-tauri-drag-region="false"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-faint transition-colors hover:bg-surface-hover hover:text-text"
            >
              <Plus strokeWidth={1.5} className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SafariTab({
  tab,
  active,
  onSelect,
  onClose,
  onContext,
}: {
  tab: SafariTab;
  active: boolean;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  onContext?: (id: string, x: number, y: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
    disabled: tab.fixed,
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
      data-tauri-drag-region="false"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(tab.id)}
      onContextMenu={(e) => {
        if (!onContext) return;
        e.preventDefault();
        onContext(tab.id, e.clientX, e.clientY);
      }}
      className={cn(
        "group/tab relative flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-body transition-colors",
        tab.pinned ? "max-w-[44px] justify-center" : "max-w-[200px]",
        active
          ? "bg-surface-elevated text-text shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.12)] dark:shadow-[0_0_0_0.5px_rgba(255,255,255,0.08),0_1px_2px_rgba(0,0,0,0.4)]"
          : "text-text-muted hover:bg-surface-hover hover:text-text",
      )}
    >
      {tab.color && (
        <span
          className="absolute left-0.5 top-1.5 h-4 w-0.5 rounded-r"
          style={{ background: tab.color }}
          aria-hidden
        />
      )}
      {tab.icon && (
        <span
          className="grid h-3.5 w-3.5 shrink-0 place-items-center overflow-hidden rounded-sm [&>*]:h-full [&>*]:w-full [&_img]:object-cover"
        >
          {tab.icon}
        </span>
      )}
      {!tab.pinned && <span className="truncate">{tab.label}</span>}
      {!tab.fixed && !tab.pinned && onClose && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
          className="ml-0.5 hidden rounded-sm p-0.5 text-text-faint transition-colors hover:bg-surface-hover hover:text-text group-hover/tab:block"
          aria-label="close"
        >
          <X strokeWidth={1.5} className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/** Floating context menu for tabs. */
export function TabContextMenu({
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
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const el = document.getElementById("__tab_ctxmenu");
      if (!el?.contains(e.target as Node)) {
        setMounted(false);
        onClose();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMounted(false);
        onClose();
      }
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  if (!mounted) return null;
  return (
    <div
      id="__tab_ctxmenu"
      style={{ position: "fixed", left: x, top: y, zIndex: 200 }}
      className="min-w-[10rem] overflow-hidden rounded-md border border-border-subtle bg-surface-overlay shadow-md"
    >
      {children}
    </div>
  );
}
