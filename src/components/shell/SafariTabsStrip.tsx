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
            "flex h-full min-w-0 flex-1 items-end gap-0.5 overflow-x-auto pt-1",
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
              className="ml-1 mb-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-faint transition-colors hover:bg-surface-hover hover:text-text"
            >
              <Plus strokeWidth={1.5} className="h-4 w-4" />
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

  function handleMouseDown(e: React.MouseEvent) {
    // Middle-click closes (browser pattern). Only for non-fixed/non-pinned tabs.
    if (e.button === 1 && !tab.fixed && !tab.pinned && onClose) {
      e.preventDefault();
      onClose(tab.id);
    }
  }

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
      onAuxClick={handleMouseDown}
      onContextMenu={(e) => {
        if (!onContext) return;
        e.preventDefault();
        onContext(tab.id, e.clientX, e.clientY);
      }}
      className={cn(
        "group/tab relative flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-t-lg px-3 text-body transition-all duration-100",
        tab.pinned ? "w-9 justify-center px-0" : "min-w-[120px] max-w-[220px]",
        active
          ? "bg-surface text-text"
          : "text-text-muted hover:bg-surface-hover/60 hover:text-text",
      )}
    >
      {/* Top accent stripe for color/provider, only when active or color set */}
      {tab.color && active && (
        <span
          className="pointer-events-none absolute inset-x-2 top-0 h-[2px] rounded-full"
          style={{ background: tab.color }}
          aria-hidden
        />
      )}
      {tab.icon && (
        <span
          className="grid h-4 w-4 shrink-0 place-items-center overflow-hidden rounded-sm [&>*]:h-full [&>*]:w-full [&_img]:object-cover"
        >
          {tab.icon}
        </span>
      )}
      {!tab.pinned && (
        <span className={cn("min-w-0 flex-1 truncate", active ? "text-text" : "text-text-muted")}>
          {tab.label}
        </span>
      )}
      {!tab.fixed && !tab.pinned && onClose && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
          className={cn(
            "grid h-5 w-5 shrink-0 place-items-center rounded-md transition-all",
            active
              ? "text-text-muted opacity-80 hover:bg-surface-hover hover:text-text hover:opacity-100"
              : "text-text-faint opacity-0 hover:bg-surface-hover hover:text-text group-hover/tab:opacity-100",
          )}
          aria-label="close"
          title="Cerrar (medio-click también)"
        >
          <X strokeWidth={1.5} className="h-3.5 w-3.5" />
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
      className="min-w-[10rem] overflow-hidden rounded-md border border-border-subtle bg-surface-overlay py-1 shadow-lg"
    >
      {children}
    </div>
  );
}
