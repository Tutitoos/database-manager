import { PanelRight, Search } from "lucide-react";
import { useInspector } from "@/lib/inspector";
import { modSymbol } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

export function ShellToolbar({ onCommand }: { onCommand: () => void }) {
  const inspector = useInspector();
  const mod = modSymbol();
  return (
    <div data-tauri-drag-region className="flex h-full shrink-0 items-center gap-1 px-2">
      <button
        type="button"
        onClick={onCommand}
        title={`Buscar (${mod}K)`}
        data-tauri-drag-region="false"
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-md border border-border-subtle bg-surface-sunken px-2 text-[11px] text-text-faint transition-colors",
          "hover:bg-surface-hover hover:text-text-muted",
        )}
      >
        <Search strokeWidth={1.5} className="h-3 w-3" />
        <span>{mod}K</span>
      </button>
      <button
        type="button"
        onClick={inspector.toggle}
        title="Inspector (⌘/)"
        data-tauri-drag-region="false"
        className={cn(
          "grid h-7 w-7 place-items-center rounded-md transition-colors",
          inspector.open
            ? "bg-surface-active text-text"
            : "text-text-faint hover:bg-surface-hover hover:text-text",
        )}
      >
        <PanelRight strokeWidth={1.5} className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
