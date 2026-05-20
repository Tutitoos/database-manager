import { useEffect, useMemo } from "react";
import { getSettings, useSettings } from "@/store/settings";
import { SHORTCUTS, type ShortcutDef } from "@/lib/shortcut-registry";

const isMac = typeof navigator !== "undefined" && /Mac|iPad|iPhone/.test(navigator.platform);

function findDef(actionId: string): ShortcutDef | undefined {
  return SHORTCUTS.find((d) => d.id === actionId);
}

function keysFor(actionId: string, overrides: Record<string, string[]>): string[] | null {
  const ov = overrides?.[actionId];
  if (ov && ov.length > 0) return ov;
  return findDef(actionId)?.defaultKeys ?? null;
}

interface MatchParts {
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

function parseTokens(tokens: string[]): MatchParts | null {
  const m: MatchParts = { meta: false, ctrl: false, alt: false, shift: false, key: "" };
  for (const t of tokens) {
    if (t === "⌘") m.meta = true;
    else if (t === "⌃") m.ctrl = true;
    else if (t === "⌥") m.alt = true;
    else if (t === "⇧") m.shift = true;
    else if (t === "↵") m.key = "Enter";
    else if (t === "Esc") m.key = "Escape";
    else if (t === "Space") m.key = " ";
    else if (t === "⌫") m.key = "Backspace";
    else if (t === "↑") m.key = "ArrowUp";
    else if (t === "↓") m.key = "ArrowDown";
    else if (t === "←") m.key = "ArrowLeft";
    else if (t === "→") m.key = "ArrowRight";
    else if (t.includes("..")) return null; // ranges like "1..9" handled separately
    else m.key = t.toLowerCase();
  }
  return m;
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (t.isContentEditable) return true;
  return false;
}

export interface UseActionOpts {
  /** Run the handler even when focus is inside an input/textarea. */
  whenInInput?: boolean;
}

/**
 * Bind an actionId to a handler. Reads the active key chord from the user's
 * `shortcutOverrides` if set, otherwise the registry default. Re-binds when
 * settings change.
 */
export function useAction(actionId: string, handler: (e: KeyboardEvent) => void, opts: UseActionOpts = {}) {
  const settings = useSettings();
  const tokens = useMemo(() => keysFor(actionId, settings.shortcutOverrides), [actionId, settings.shortcutOverrides]);
  const parsed = useMemo(() => (tokens ? parseTokens(tokens) : null), [tokens]);

  useEffect(() => {
    if (!parsed) return;
    function onKey(e: KeyboardEvent) {
      if (!parsed) return;
      if (parsed.meta !== (isMac ? e.metaKey : e.ctrlKey)) return;
      if (parsed.shift !== e.shiftKey) return;
      if (parsed.alt !== e.altKey) return;
      // For non-mac, ctrl flag is folded into the meta check above; explicit
      // ctrl modifier (⌃ on mac) is checked separately if defined.
      if (isMac && parsed.ctrl !== e.ctrlKey) return;
      if (e.key.toLowerCase() !== parsed.key.toLowerCase()) return;
      if (!opts.whenInInput && isTypingTarget(e.target)) return;
      handler(e);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [parsed, handler, opts.whenInInput]);
}

