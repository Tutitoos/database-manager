import { cn } from "@/lib/utils";

export function PageHeader({
  left,
  title,
  subtitle,
  right,
  className,
}: {
  /** Slot for breadcrumb / back link / icon. */
  left?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Slot for action buttons / view-switcher. */
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-3 border-b border-border-subtle bg-surface px-4",
        className,
      )}
    >
      {left}
      {(title || subtitle) && (
        <div className="min-w-0">
          {title && <h1 className="text-h1 truncate text-text">{title}</h1>}
          {subtitle && <p className="text-caption truncate text-text-muted">{subtitle}</p>}
        </div>
      )}
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </header>
  );
}

/** Segmented control commonly used in PageHeader.right to switch tabs. */
export function SegmentedTabs<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: React.ReactNode }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-border-subtle bg-surface-sunken p-1",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "text-body inline-flex h-7 items-center gap-1.5 rounded-md px-3 font-medium transition-all",
              active
                ? "bg-accent text-text-on-accent shadow-[0_1px_2px_rgba(0,0,0,.25)]"
                : "text-text-muted hover:bg-surface-hover hover:text-text",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
