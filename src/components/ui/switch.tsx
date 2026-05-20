import { cn } from "@/lib/utils";

export function Switch({
  checked,
  onCheckedChange,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      disabled={disabled}
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "bg-accent"
          : "bg-surface-sunken hover:bg-surface-hover",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full shadow-sm transition-transform",
          checked
            ? "translate-x-4 bg-text-on-accent"
            : "translate-x-0 bg-text-muted",
        )}
      />
    </button>
  );
}
