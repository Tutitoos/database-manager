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
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-zinc-800 text-white"
          : "text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300",
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
        "flex items-center gap-1.5 border-b-2 pb-2 text-xs font-medium transition-colors",
        active
          ? "border-blue-500 text-white"
          : "border-transparent text-zinc-500 hover:text-zinc-300",
        className
      )}
    >
      {children}
    </button>
  );
}
