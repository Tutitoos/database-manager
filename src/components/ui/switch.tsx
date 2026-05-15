"use client";

import { cn } from "@/lib/utils";

export function Switch({ checked, onCheckedChange, disabled }: { checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-5 w-9 rounded-full border transition-colors disabled:opacity-50",
        checked ? "border-white bg-white" : "border-zinc-600 bg-zinc-800 hover:border-zinc-500"
      )}
    >
      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full transition", checked ? "left-4 bg-black" : "left-0.5 bg-zinc-300")} />
    </button>
  );
}
