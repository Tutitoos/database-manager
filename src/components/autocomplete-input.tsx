"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type SuggestionItem = {
  label: string;
  hint?: string;
  color?: string;
};

export type SuggestionResult = {
  items: SuggestionItem[];
  replaceStart: number;
  replaceEnd: number;
};

export type GetSuggestions = (value: string, cursorPos: number) => SuggestionResult;

export function getWordAtPos(text: string, pos: number): { word: string; start: number; end: number } {
  const before = text.slice(0, pos);
  const after = text.slice(pos);
  const matchBefore = before.match(/[\w$._-]+$/);
  const matchAfter = after.match(/^[\w$._-]+/);
  const start = matchBefore ? pos - matchBefore[0].length : pos;
  const end = matchAfter ? pos + matchAfter[0].length : pos;
  return { word: text.slice(start, end), start, end };
}

function wordSuggestions(value: string, cursorPos: number, suggestions: SuggestionItem[]): SuggestionResult {
  const { word, start, end } = getWordAtPos(value, cursorPos);
  const items = word.length >= 1
    ? suggestions.filter(
        (s) =>
          s.label.toLowerCase().startsWith(word.toLowerCase()) &&
          s.label.toLowerCase() !== word.toLowerCase()
      )
    : [];
  return { items, replaceStart: start, replaceEnd: end };
}

type DropdownRect = { top: number; left: number; minWidth: number };

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  getSuggestions?: GetSuggestions;
  suggestions?: SuggestionItem[];
  placeholder?: string;
  className?: string;
  onFocusChange?: (focused: boolean) => void;
};

export function AutocompleteInput({
  value,
  onChange,
  onSubmit,
  getSuggestions,
  suggestions = [],
  placeholder,
  className,
  onFocusChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [suggestion, setSuggestion] = useState<SuggestionResult>({ items: [], replaceStart: 0, replaceEnd: 0 });
  const [rect, setRect] = useState<DropdownRect | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const showDropdown = dropdownOpen && suggestion.items.length > 0;

  function measureInput() {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left, minWidth: Math.min(r.width, window.innerWidth - r.left - 12) });
  }

  function computeSuggestions(val: string, el: HTMLInputElement | null) {
    const pos = el?.selectionStart ?? val.length;
    const result = getSuggestions
      ? getSuggestions(val, pos)
      : wordSuggestions(val, pos, suggestions);
    setSuggestion(result);
    setActiveIdx(0);
    measureInput();
  }

  useEffect(() => {
    const el = dropdownRef.current?.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  useEffect(() => {
    if (!showDropdown) return;
    const onScroll = () => measureInput();
    const onResize = () => measureInput();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [showDropdown]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value);
    computeSuggestions(e.target.value, e.target);
    setDropdownOpen(true);
  }

  function handleSelect(item: SuggestionItem) {
    const input = inputRef.current;
    if (!input) return;
    const { replaceStart, replaceEnd } = suggestion;
    const newVal = value.slice(0, replaceStart) + item.label + value.slice(replaceEnd);
    onChange(newVal);
    setDropdownOpen(false);
    requestAnimationFrame(() => {
      input.focus();
      const pos = replaceStart + item.label.length;
      input.setSelectionRange(pos, pos);
      computeSuggestions(newVal, input);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (showDropdown) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, suggestion.items.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Tab" || (e.key === "Enter" && suggestion.items[activeIdx])) {
        e.preventDefault();
        handleSelect(suggestion.items[activeIdx]);
        return;
      }
      if (e.key === "Escape") { setDropdownOpen(false); return; }
    }
    if (e.key === "Enter" && onSubmit) { e.preventDefault(); onSubmit(); }
  }

  function handleKeyUp(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Tab" || e.key === "Enter" || e.key === "Escape") return;
    computeSuggestions(value, inputRef.current);
  }

  const dropdown = mounted && showDropdown && rect
    ? createPortal(
        <div
          style={{ position: "fixed", top: rect.top, left: rect.left, minWidth: rect.minWidth, maxWidth: window.innerWidth - rect.left - 12 }}
          ref={dropdownRef}
          className="z-9999 max-h-52 overflow-y-auto rounded-lg border border-zinc-700/80 bg-zinc-900 shadow-2xl shadow-black/50"
        >
          {suggestion.items.map((item, i) => (
            <button
              key={item.label}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(item); }}
              className={cn(
                "flex w-full items-center justify-between gap-3 whitespace-nowrap px-3 py-1.5 text-left transition-colors",
                i === activeIdx ? "bg-zinc-700/80 text-white" : "text-zinc-300 hover:bg-zinc-800/60"
              )}
            >
              <span className="font-mono text-xs">{item.label}</span>
              {item.hint && (
                <span className={cn("shrink-0 text-[10px]", item.color ?? "text-zinc-600")}>
                  {item.hint}
                </span>
              )}
            </button>
          ))}
        </div>,
        document.body
      )
    : null;

  return (
    <div className="relative flex min-w-0 flex-1 items-center">
      <input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onClick={() => { measureInput(); computeSuggestions(value, inputRef.current); }}
        onFocus={() => { computeSuggestions(value, inputRef.current); setDropdownOpen(true); onFocusChange?.(true); }}
        onBlur={() => { setTimeout(() => { setDropdownOpen(false); onFocusChange?.(false); }, 120); }}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className={className}
      />
      {dropdown}
    </div>
  );
}
