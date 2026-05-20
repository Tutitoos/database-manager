import { useOrgs } from "@/store/orgs";

export const DEFAULT_LOCAL_ACCENT = "#71717a";
export const DEFAULT_REMOTE_ACCENT = "#0ea5e9";

/** Resolves the accent color of the active org (or sensible fallback) for
 *  chrome elements that should reflect "which org you're on" — UserMenu,
 *  StatusBar, etc. Reactive: re-evaluates whenever the org store updates. */
export function useActiveOrgAccent(): string {
  const { orgs, activeId } = useOrgs();
  const active = orgs.find((o) => o.id === activeId);
  if (!active) return DEFAULT_LOCAL_ACCENT;
  return active.accent_color ?? (active.server_kind === "local" ? DEFAULT_LOCAL_ACCENT : DEFAULT_REMOTE_ACCENT);
}
