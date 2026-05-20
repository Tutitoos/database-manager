import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function Dropdown({
  trigger,
  children,
  align = "start",
  direction = "down",
  className,
  triggerClassName,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  align?: "start" | "end";
  direction?: "down" | "up";
  className?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={cn("relative inline-flex", triggerClassName)}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="contents">
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute z-[60] min-w-[10rem] overflow-hidden rounded-md border border-border-subtle bg-surface-overlay shadow-md",
            direction === "up" ? "bottom-full mb-1" : "top-full mt-1",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
        >
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({
  className,
  icon,
  danger,
  onClick,
  children,
  disabled,
  shortcut,
}: {
  className?: string;
  icon?: React.ReactNode;
  danger?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-body text-text transition-colors",
        "hover:bg-surface-hover",
        danger && "text-danger hover:bg-danger-soft",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="ml-auto text-[10px] text-text-faint">{shortcut}</span>}
    </button>
  );
}

export function DropdownGroup({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border-subtle py-1 last:border-b-0">
      {label && (
        <p className="px-3 pb-1 pt-0.5 text-[9px] font-semibold uppercase tracking-wider text-text-faint">
          {label}
        </p>
      )}
      {children}
    </div>
  );
}

export function DropdownSeparator() {
  return <div className="my-1 h-px bg-border-subtle" />;
}

/** Caret icon helper for triggers. */
export function DropdownCaret() {
  return <ChevronDown strokeWidth={1.5} className="h-3 w-3 text-text-faint" />;
}
