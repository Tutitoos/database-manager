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
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring",
        variant === "primary" && "border-transparent bg-accent text-text-on-accent hover:bg-accent-hover",
        variant === "secondary" && "border-border-subtle bg-surface-elevated text-text hover:border-border-strong hover:bg-surface-hover",
        variant === "ghost" && "border-transparent bg-transparent text-text-muted hover:bg-surface-hover hover:text-text",
        variant === "danger" && "border-transparent bg-danger text-text-on-accent hover:brightness-110",
        size === "sm" && "h-8 px-3 text-body",
        size === "md" && "h-9 px-3.5 text-h3",
        size === "icon" && "h-8 w-8 p-0",
        className,
      )}
      {...props}
    />
  );
}
