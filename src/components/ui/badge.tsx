import { cn } from "@/lib/utils";

export function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md border border-border-subtle bg-surface-sunken px-1.5 text-[11px] font-medium leading-none text-text",
        className,
      )}
    >
      {children}
    </span>
  );
}
