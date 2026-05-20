import { cn } from "@/lib/utils";

type Variant = "success" | "warn" | "danger" | "info" | "neutral";

const STYLE: Record<Variant, { bg: string; text: string; dot: string }> = {
  success: { bg: "bg-success-soft", text: "text-success", dot: "bg-success" },
  warn: { bg: "bg-warn-soft", text: "text-warn", dot: "bg-warn" },
  danger: { bg: "bg-danger-soft", text: "text-danger", dot: "bg-danger" },
  info: { bg: "bg-info-soft", text: "text-info", dot: "bg-info" },
  neutral: { bg: "bg-surface-sunken", text: "text-text-muted", dot: "bg-text-faint" },
};

export function StatusPill({
  variant = "neutral",
  children,
  dot = true,
  className,
  onClick,
  title,
}: {
  variant?: Variant;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
  onClick?: () => void;
  title?: string;
}) {
  const s = STYLE[variant];
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium",
        s.bg,
        s.text,
        onClick && "cursor-pointer transition-colors hover:brightness-110",
        className,
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />}
      {children}
    </Tag>
  );
}
