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
        "mb-1 flex h-8 items-center gap-3 rounded-md border border-transparent px-3 text-sm text-zinc-400",
        active && "border-zinc-700/70 bg-zinc-900 text-white",
        onClick && "cursor-pointer hover:text-zinc-200"
      )}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {count !== undefined && <Badge>{count}</Badge>}
    </div>
  );
}
