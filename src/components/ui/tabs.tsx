import type React from "react";
import { cn } from "@/lib/utils";

export function Tabs({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex items-center gap-0.5", className)}>{children}</div>;
}

export function Tab({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-body font-medium transition-colors",
        active
          ? "bg-surface-hover text-text"
          : "text-text-faint hover:bg-surface-hover hover:text-text",
        className
      )}
    >
      {children}
    </button>
  );
}

export function TabLine({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 border-b-2 pb-2 text-body font-medium transition-colors",
        active
          ? "border-blue-500 text-text"
          : "border-transparent text-text-faint hover:text-text",
        className
      )}
    >
      {children}
    </button>
  );
}
