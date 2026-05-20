import { forwardRef } from "react";
import type React from "react";
import { cn } from "@/lib/utils";
import { inputBase } from "@/lib/styles";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(inputBase, className)} {...props} />;
  },
);
