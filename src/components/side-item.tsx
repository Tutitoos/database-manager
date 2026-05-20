import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export function SideItem({
  active,
  icon,
  label,
  count,
  onClick
}: {
  active?: boolean;
  icon: React.ReactNode;
  label: string;
  count?: number;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "mb-1 flex h-8 items-center gap-3 rounded-md border border-transparent px-3 text-h3 text-text-muted",
        active && "border-border-strong bg-surface-elevated text-text",
        onClick && "cursor-pointer hover:text-text"
      )}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {count !== undefined && <Badge>{count}</Badge>}
    </div>
  );
}
