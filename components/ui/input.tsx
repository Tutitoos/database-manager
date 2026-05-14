"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-md border border-zinc-700/70 bg-[#0a0a0a] px-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-500",
        "hover:border-zinc-600 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/20",
        className
      )}
      {...props}
    />
  );
}
