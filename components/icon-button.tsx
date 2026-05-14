"use client";

import { cn } from "@/lib/utils";

export function IconButton({
  active,
  label,
  children,
  onClick
}: {
  active: boolean;
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
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
