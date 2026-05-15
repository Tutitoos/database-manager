import type React from "react";
import { cn } from "@/lib/utils";
import { inputBase } from "@/lib/styles";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputBase, className)} {...props} />;
}
