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

  const activeIdx = items.findIndex((t) => t.id === activeId);

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
        <div
          data-tauri-drag-region
          className={cn(
            "flex h-full min-w-0 flex-1 items-stretch overflow-x-auto",
            "[&::-webkit-scrollbar]:h-0",
            className,
          )}
          style={{ paddingLeft: reserveTrafficLights ? 80 : 4 }}
        >
          {items.map((tab, i) => (
            <SafariTab
              key={tab.id}
              tab={tab}
              active={activeId === tab.id}
              /** Hide left divider when this tab OR the previous one is active */
              hideLeftDivider={i === 0 || i === activeIdx || i - 1 === activeIdx}
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
              className="grid h-full w-9 shrink-0 place-items-center text-text-faint transition-colors hover:bg-surface-hover hover:text-text"
            >
              <Plus strokeWidth={1.5} className="h-4 w-4" />
            </button>
          )}
          {/* Drag region filler to the right of the last tab + new-tab button */}
          <div data-tauri-drag-region className="flex-1" />
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SafariTab({
  tab,
  active,
  hideLeftDivider,
  onSelect,
  onClose,
  onContext,
}: {
  tab: SafariTab;
  active: boolean;
  hideLeftDivider: boolean;
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

  function onAuxClick(e: React.MouseEvent) {
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
      onAuxClick={onAuxClick}
      onContextMenu={(e) => {
        if (!onContext) return;
        e.preventDefault();
        onContext(tab.id, e.clientX, e.clientY);
      }}
      className={cn(
        "group/tab relative flex h-full shrink-0 cursor-pointer items-center gap-2 px-4 text-body transition-colors",
        tab.pinned ? "w-10 justify-center px-0" : "min-w-[140px] max-w-[220px] justify-center",
        active
          ? "bg-surface-elevated text-text"
          : "text-text-muted hover:bg-surface-hover/50 hover:text-text",
      )}
    >
      {/* Vertical divider on the left edge (hidden when previous tab or self is active) */}
      {!hideLeftDivider && (
        <span
          className="pointer-events-none absolute left-0 top-1/2 h-4 w-px -translate-y-1/2 bg-border-subtle"
          aria-hidden
        />
      )}
      {/* Top accent bar on active tab */}
      {active && (
        <span
          className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-accent"
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
        <span className="min-w-0 truncate text-center">
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
            "absolute right-2 grid h-4 w-4 place-items-center rounded-sm transition-all",
            active
              ? "text-text-muted opacity-0 hover:bg-surface-hover hover:text-text group-hover/tab:opacity-100"
              : "text-text-faint opacity-0 hover:bg-surface-hover hover:text-text group-hover/tab:opacity-100",
          )}
          aria-label="close"
          title="Cerrar (middle-click)"
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
      className="min-w-[10rem] overflow-hidden rounded-md border border-border-subtle bg-surface-overlay py-1 shadow-lg"
    >
      {children}
    </div>
  );
}
