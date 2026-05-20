import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useInspector } from "@/lib/inspector";
import { cn } from "@/lib/utils";

export function InspectorPane() {
  const { t } = useTranslation();
  const { open, content } = useInspector();
  if (!open) return null;
  return (
    <aside
      className={cn(
        "flex w-72 shrink-0 flex-col border-l border-border-subtle bg-surface",
        "overflow-hidden",
      )}
    >
      <header className="flex h-9 shrink-0 items-center border-b border-border-subtle bg-surface-sunken px-3">
        <span className="text-[10px] font-semibold uppercase tracking-[.12em] text-text-faint">
          {t("inspector.title")}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto p-3 text-body">
        {content ?? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-text-faint">
            <Info strokeWidth={1.5} className="h-5 w-5" />
            <p className="text-center text-[11px]">{t("inspector.empty")}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
