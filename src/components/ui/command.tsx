import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CommandItem {
  id: string;
  label: string;
  /** Secondary text shown to the right (e.g. shortcut). */
  hint?: string;
  /** Optional search keywords beyond the label. */
  keywords?: string[];
  icon?: React.ReactNode;
  group?: string;
  onSelect: () => void;
}

interface Props {
  items: CommandItem[];
  placeholder?: string;
  emptyLabel?: string;
  onClose?: () => void;
}

function fuzzyMatch(text: string, query: string): number | null {
  if (!query) return 0;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t.includes(q)) return 1000 - t.indexOf(q);
  // Subsequence match — score by tightness.
  let score = 0;
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    score -= found - ti;
    ti = found + 1;
  }
  return score;
}

export function CommandList({ items, placeholder = "Buscar…", emptyLabel = "Sin resultados", onClose }: Props) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (!query) return items;
    return items
      .map((item) => {
        const haystack = [item.label, ...(item.keywords ?? [])].join(" ");
        const score = fuzzyMatch(haystack, query);
        return score == null ? null : { item, score };
      })
      .filter((x): x is { item: CommandItem; score: number } => x != null)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  }, [items, query]);

  // Reset selection when filter narrows.
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[activeIdx];
      if (item) {
        item.onSelect();
        onClose?.();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose?.();
    }
  }

  // Scroll active item into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  // Group items in render order, preserving filtered order.
  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, CommandItem[]>();
    for (const it of filtered) {
      const g = it.group ?? "";
      if (!map.has(g)) {
        order.push(g);
        map.set(g, []);
      }
      map.get(g)!.push(it);
    }
    return order.map((g) => ({ group: g, items: map.get(g)! }));
  }, [filtered]);

  let runningIdx = -1;

  return (
    <div className="flex max-h-[60vh] flex-col" onKeyDown={onKey}>
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2.5">
        <Search strokeWidth={1.5} className="h-4 w-4 text-text-faint" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-h3 text-text placeholder:text-text-faint outline-none"
        />
        <kbd className="rounded-sm border border-border-subtle bg-surface-sunken px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
          Esc
        </kbd>
      </div>
      <div ref={listRef} className="overflow-y-auto">
        {grouped.length === 0 ? (
          <p className="px-4 py-6 text-center text-body text-text-muted">{emptyLabel}</p>
        ) : (
          grouped.map(({ group, items: gItems }) => (
            <div key={group || "_"} className="border-b border-border-subtle py-1 last:border-b-0">
              {group && (
                <p className="px-3 pb-1 pt-0.5 text-[9px] font-semibold uppercase tracking-wider text-text-faint">
                  {group}
                </p>
              )}
              {gItems.map((it) => {
                runningIdx++;
                const idx = runningIdx;
                const active = idx === activeIdx;
                return (
                  <button
                    key={it.id}
                    data-cmd-idx={idx}
                    onMouseMove={() => setActiveIdx(idx)}
                    onClick={() => {
                      it.onSelect();
                      onClose?.();
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-2 text-left text-h3 transition-colors",
                      active ? "bg-accent-soft text-text" : "text-text-muted hover:bg-surface-hover",
                    )}
                  >
                    {it.icon && <span className="shrink-0 text-text-faint">{it.icon}</span>}
                    <span className="flex-1 truncate">{it.label}</span>
                    {it.hint && <span className="ml-auto text-[10px] text-text-faint">{it.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
