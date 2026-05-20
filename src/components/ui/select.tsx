import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Option {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  className?: string;
  placeholder?: string;
  upward?: boolean;
}

export function Select({ value, onChange, options, className, placeholder, upward }: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  const selectedOption = options.find((o) => o.value === value);

  return (
    <div className="relative flex w-full items-center" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn(
          "group inline-flex h-8 w-full items-center justify-between gap-2 rounded-md border bg-surface px-2.5 pr-8 text-left text-[13px] text-text outline-none transition-colors",
          open
            ? "border-accent/60 ring-1 ring-accent/20"
            : "border-border-subtle hover:border-border-strong hover:bg-surface-hover",
          "disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
      >
        <span className={cn("truncate", !selectedOption && "text-text-faint")}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
      </button>
      <ChevronDown
        strokeWidth={1.75}
        className={cn(
          "pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint transition-transform duration-150",
          open && "rotate-180 text-text-muted",
        )}
      />

      {open && (
        <div
          className={cn(
            "absolute left-0 z-50 min-w-full overflow-hidden rounded-md border border-border-subtle bg-surface-overlay p-1 shadow-lg ring-1 ring-black/5",
            "animate-in fade-in-0 zoom-in-95 duration-100",
            upward ? "bottom-full mb-1 origin-bottom" : "top-full mt-1 origin-top",
          )}
        >
          <div className="max-h-60 overflow-y-auto">
            {options.map((option) => {
              const active = value === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] transition-colors",
                    active
                      ? "bg-accent-soft text-text"
                      : "text-text-muted hover:bg-surface-hover hover:text-text",
                  )}
                >
                  <Check
                    strokeWidth={2.5}
                    className={cn(
                      "h-3 w-3 shrink-0 transition-opacity",
                      active ? "text-accent opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
