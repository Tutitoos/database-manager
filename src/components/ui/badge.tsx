import { cn } from "@/lib/utils";

export function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-md border border-zinc-700/70 bg-zinc-900/70 px-1.5 text-[11px] font-medium leading-none text-zinc-300", className)}>
      {children}
    </span>
  );
}
