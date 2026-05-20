const isMac = typeof navigator !== "undefined" && /Mac|iPad|iPhone/.test(navigator.platform);

/** Helper for "Mod" tooltips: returns "⌘" on macOS, "Ctrl" elsewhere. */
export function modSymbol(): string {
  return isMac ? "⌘" : "Ctrl";
}
