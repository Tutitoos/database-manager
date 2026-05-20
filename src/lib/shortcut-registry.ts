export type ShortcutCategory = "navigation" | "tabs" | "query" | "view" | "window";

export interface ShortcutDef {
  id: string;
  category: ShortcutCategory;
  /** i18n key under "shortcuts.actions". */
  labelKey: string;
  /** Default keys, displayed as labels. Use canonical form (lowercase letters; meta symbols ⌘/Ctrl). */
  defaultKeys: string[];
  /** When true, key can't be rebound by the user (managed by OS / Tauri menu). */
  systemManaged?: boolean;
}

export const SHORTCUTS: ShortcutDef[] = [
  // Navigation
  { id: "commandPalette", category: "navigation", labelKey: "commandPalette", defaultKeys: ["⌘", "K"] },
  { id: "openSettings", category: "navigation", labelKey: "openSettings", defaultKeys: ["⌘", ","], systemManaged: true },
  { id: "focusSearch", category: "navigation", labelKey: "focusSearch", defaultKeys: ["⌘", "F"] },
  { id: "switchOrg", category: "navigation", labelKey: "switchOrg", defaultKeys: ["⌃", "⇧", "O"] },
  // View
  { id: "toggleSidebar", category: "view", labelKey: "toggleSidebar", defaultKeys: ["⌘", "B"] },
  { id: "toggleInspector", category: "view", labelKey: "toggleInspector", defaultKeys: ["⌘", "/"] },
  { id: "zoomIn", category: "view", labelKey: "zoomIn", defaultKeys: ["⌘", "="] },
  { id: "zoomOut", category: "view", labelKey: "zoomOut", defaultKeys: ["⌘", "-"] },
  { id: "zoomReset", category: "view", labelKey: "zoomReset", defaultKeys: ["⌘", "0"] },
  // Tabs
  { id: "newTab", category: "tabs", labelKey: "newTab", defaultKeys: ["⌘", "T"] },
  { id: "closeTab", category: "tabs", labelKey: "closeTab", defaultKeys: ["⌘", "W"] },
  { id: "closeOtherTabs", category: "tabs", labelKey: "closeOtherTabs", defaultKeys: ["⌘", "⌥", "W"] },
  { id: "closeAllTabs", category: "tabs", labelKey: "closeAllTabs", defaultKeys: ["⌘", "⇧", "W"] },
  { id: "pinTab", category: "tabs", labelKey: "pinTab", defaultKeys: ["⌘", "⇧", "P"] },
  { id: "jumpToTab", category: "tabs", labelKey: "jumpToTab", defaultKeys: ["⌘", "1..9"], systemManaged: true },
  // Query
  { id: "runQuery", category: "query", labelKey: "runQuery", defaultKeys: ["⌘", "↵"] },
  { id: "cancelQuery", category: "query", labelKey: "cancelQuery", defaultKeys: ["Esc"] },
];

export const CATEGORIES: ShortcutCategory[] = ["navigation", "view", "tabs", "query"];

/** Build a token array from a KeyboardEvent. Returns null if only modifier keys held. */
export function eventToKeys(e: KeyboardEvent): string[] | null {
  const out: string[] = [];
  if (e.metaKey) out.push("⌘");
  if (e.ctrlKey) out.push("⌃");
  if (e.altKey) out.push("⌥");
  if (e.shiftKey) out.push("⇧");
  const k = e.key;
  if (["Meta", "Control", "Alt", "Shift"].includes(k)) return null;
  if (k === " ") out.push("Space");
  else if (k === "Enter") out.push("↵");
  else if (k === "Escape") out.push("Esc");
  else if (k === "Backspace") out.push("⌫");
  else if (k === "Tab") out.push("Tab");
  else if (k === "ArrowUp") out.push("↑");
  else if (k === "ArrowDown") out.push("↓");
  else if (k === "ArrowLeft") out.push("←");
  else if (k === "ArrowRight") out.push("→");
  else out.push(k.length === 1 ? k.toUpperCase() : k);
  return out;
}
