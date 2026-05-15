import type React from "react";
import { cn } from "@/lib/utils";
import { selectBase } from "@/lib/styles";

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, ...props }: SelectProps) {
  return <select className={cn(selectBase, className)} {...props} />;
}
