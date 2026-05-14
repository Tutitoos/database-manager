"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "icon";
};

export function Button({ className, variant = "secondary", size = "md", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/30",
        variant === "primary" && "border-white bg-white text-black hover:bg-zinc-200",
        variant === "secondary" && "border-zinc-700/70 bg-[#0a0a0a] text-zinc-100 hover:border-zinc-600 hover:bg-zinc-900",
        variant === "ghost" && "border-transparent bg-transparent text-zinc-400 hover:bg-zinc-900/80 hover:text-zinc-100",
        variant === "danger" && "border-red-900/70 bg-[#0a0a0a] text-red-300 hover:border-red-800 hover:bg-red-950/30",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-9 px-3.5 text-sm",
        size === "icon" && "h-8 w-8 p-0",
        className
      )}
      {...props}
    />
  );
}
