import { cn } from "@/lib/utils";

export function SettingsCard({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col", className)}>
      {(title || description) && (
        <header className="mb-2 px-1">
          {title && <h2 className="text-overline">{title}</h2>}
          {description && <p className="text-caption mt-0.5 text-text-faint">{description}</p>}
        </header>
      )}
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-elevated">
        {children}
      </div>
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  control,
  className,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  control: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 border-b border-border-subtle px-4 py-3 last:border-b-0",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-body text-text">{label}</p>
        {description && <p className="text-caption mt-0.5 text-text-muted">{description}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
