import { Sparkles } from "lucide-react";

/** Centered "Coming soon" placeholder used while the UI is being rebuilt.
 *  Renders inside the layout's main slot — shell (sidebar, session tabs,
 *  OrgSwitcher, StatusBar) stays fully functional around it. */
export function ComingSoon({
  title = "Coming soon",
  subtitle = "Esta vista se está rediseñando.",
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-surface/30 p-10">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-2xl border border-border-subtle bg-surface-elevated text-text-faint shadow-inner">
          <Sparkles strokeWidth={1.5} className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-h2 font-medium text-text">{title}</h2>
          <p className="mt-1 text-body text-text-faint">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}
