import type React from "react";
import { cn } from "@/lib/utils";

export function IconButton({
  active,
  label,
  children,
  onClick,
  showLabel = false,
}: {
  active: boolean;
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  showLabel?: boolean;
}) {
  if (showLabel) {
    return (
      <button
        type="button"
        title={label}
        onClick={onClick}
        className={cn(
          "flex w-full flex-col items-center gap-1 overflow-hidden rounded-md border border-transparent px-1 py-2 transition-colors hover:border-zinc-700/70 hover:bg-zinc-900",
          active ? "border-zinc-700 bg-zinc-900 text-white" : "text-zinc-400 hover:text-zinc-100"
        )}
      >
        {children}
        <span className={cn("max-w-full truncate text-[9px] font-medium leading-none", active ? "text-white" : "text-zinc-500")}>
          {label}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={cn(
        "grid h-9 w-9 place-items-center rounded-md border border-transparent text-zinc-400 transition-colors hover:border-zinc-700/70 hover:bg-zinc-900 hover:text-zinc-100",
        active && "border-zinc-700 bg-zinc-900 text-white"
      )}
    >
      {children}
    </button>
  );
}
