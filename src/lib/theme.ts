import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import i18n from "i18next";

export type ThemeMode = "dark" | "light" | "system" | "midnight" | "sepia" | "solarized" | "schedule";
export type Accent = "cyan" | "violet" | "emerald" | "amber" | "rose" | "indigo" | "custom";
export type Density = "compact" | "comfortable";
export type Locale = "es" | "en";
export type FontFamily = "system" | "inter" | "mono";

export const THEMES: ThemeMode[] = ["light", "dark", "system", "midnight", "sepia", "solarized", "schedule"];
export const ACCENTS: Accent[] = ["cyan", "violet", "emerald", "amber", "rose", "indigo"];
export const FONTS: FontFamily[] = ["system", "inter", "mono"];

interface AppearanceState {
  theme: ThemeMode;
  accent: Accent;
  customAccentHex: string;
  density: Density;
  locale: Locale;
  font: FontFamily;
  /** Hour 0-23 to switch to dark when theme === "schedule". */
  scheduleDarkAt: number;
  scheduleLightAt: number;
}

const DEFAULTS: AppearanceState = {
  theme: "system",
  accent: "cyan",
  customAccentHex: "#0ea5e9",
  density: "compact",
  locale: "es",
  font: "system",
  scheduleDarkAt: 19,
  scheduleLightAt: 7,
};

const LS_KEY = "dbm.appearance";

function readLocal(): AppearanceState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function writeLocal(state: AppearanceState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch { /* ignore quota */ }
}

function resolveSystem(): "dark" | "light" {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveSchedule(state: AppearanceState): "dark" | "light" {
  const h = new Date().getHours();
  if (state.scheduleDarkAt <= state.scheduleLightAt) {
    return h >= state.scheduleDarkAt && h < state.scheduleLightAt ? "dark" : "light";
  }
  return h >= state.scheduleDarkAt || h < state.scheduleLightAt ? "dark" : "light";
}

function resolveTheme(state: AppearanceState): string {
  if (state.theme === "system") return resolveSystem();
  if (state.theme === "schedule") return resolveSchedule(state);
  return state.theme;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function lighten(hex: string, amount = 0.15): string {
  const clean = hex.replace("#", "");
  const r = Math.min(255, Math.round(parseInt(clean.substring(0, 2), 16) + 255 * amount));
  const g = Math.min(255, Math.round(parseInt(clean.substring(2, 4), 16) + 255 * amount));
  const b = Math.min(255, Math.round(parseInt(clean.substring(4, 6), 16) + 255 * amount));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function applyCustomAccent(hex: string) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--accent-custom", hex);
  root.style.setProperty("--accent-custom-hover", lighten(hex, 0.12));
  root.style.setProperty("--accent-custom-soft", hexToRgba(hex, 0.14));
  root.style.setProperty("--accent-custom-ring", hexToRgba(hex, 0.35));
}

function applyFont(font: FontFamily) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const stacks: Record<FontFamily, string> = {
    system: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Inter", "Segoe UI", system-ui, ui-sans-serif, sans-serif`,
    inter: `"Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`,
    mono: `"SF Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`,
  };
  root.style.setProperty("--font-ui", stacks[font]);
  document.body.style.fontFamily = stacks[font];
}

function applyDom(state: AppearanceState) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const resolved = resolveTheme(state);
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-accent", state.accent);
  root.setAttribute("data-density", state.density);
  root.setAttribute("lang", state.locale);
  if (state.accent === "custom") applyCustomAccent(state.customAccentHex);
  applyFont(state.font);
  if (i18n.language !== state.locale) {
    void i18n.changeLanguage(state.locale);
  }
}

let current: AppearanceState = readLocal();
let listeners: Array<(s: AppearanceState) => void> = [];
let systemListenerAttached = false;
let scheduleInterval: number | undefined;

function notify() {
  for (const fn of listeners) fn(current);
}

function attachSystemListener() {
  if (systemListenerAttached || typeof window === "undefined" || !window.matchMedia) return;
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", () => {
    if (current.theme === "system") {
      applyDom(current);
      notify();
    }
  });
  systemListenerAttached = true;
}

function setupSchedule() {
  if (typeof window === "undefined") return;
  if (scheduleInterval) window.clearInterval(scheduleInterval);
  if (current.theme !== "schedule") return;
  scheduleInterval = window.setInterval(() => {
    if (current.theme === "schedule") {
      applyDom(current);
      notify();
    }
  }, 60_000) as unknown as number;
}

export function bootAppearance() {
  applyDom(current);
  attachSystemListener();
  setupSchedule();
  void hydrateFromBackend();
}

async function hydrateFromBackend() {
  try {
    const raw = await invoke<string | null>("get_app_setting", { key: "app.appearance" });
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<AppearanceState>;
    const next: AppearanceState = { ...current, ...parsed };
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    current = next;
    writeLocal(current);
    applyDom(current);
    setupSchedule();
    notify();
  } catch { /* ignore */ }
}

function persist() {
  writeLocal(current);
  void invoke("set_app_setting", { key: "app.appearance", valueJson: JSON.stringify(current) }).catch(() => undefined);
}

export function getAppearance(): AppearanceState {
  return current;
}

function update(partial: Partial<AppearanceState>) {
  current = { ...current, ...partial };
  applyDom(current);
  setupSchedule();
  notify();
  persist();
}

export function setTheme(theme: ThemeMode) { update({ theme }); }
export function setAccent(accent: Accent) { update({ accent }); }
export function setCustomAccentHex(hex: string) { update({ accent: "custom", customAccentHex: hex }); }
export function setDensity(density: Density) { update({ density }); }
export function setLocale(locale: Locale) { update({ locale }); }
export function setFont(font: FontFamily) { update({ font }); }
export function setSchedule(darkAt: number, lightAt: number) { update({ scheduleDarkAt: darkAt, scheduleLightAt: lightAt }); }

export function useAppearance(): AppearanceState {
  const [state, setState] = useState<AppearanceState>(current);
  useEffect(() => {
    const fn = (s: AppearanceState) => setState(s);
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  }, []);
  return state;
}

export function useResolvedTheme(): "dark" | "light" {
  const state = useAppearance();
  const [systemDark, setSystemDark] = useState(resolveSystem() === "dark");
  useEffect(() => {
    if (state.theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [state.theme]);
  const resolved = resolveTheme(state);
  if (state.theme === "system") return systemDark ? "dark" : "light";
  if (resolved === "midnight" || resolved === "solarized" || resolved === "dark") return "dark";
  return "light";
}
