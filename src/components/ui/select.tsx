import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
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
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOption = options.find((o) => o.value === value);

  return (
    <div className="relative flex w-full items-center" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "h-9 w-full appearance-none rounded-lg border border-white/5 bg-black/40 pl-3 pr-8 text-sm text-zinc-200 flex items-center justify-between gap-2",
          "shadow-inner outline-none transition-all",
          "hover:border-white/10 hover:bg-white/5",
          "focus:border-white/20 focus:ring-1 focus:ring-white/10",
          "disabled:pointer-events-none disabled:opacity-50",
          className
        )}
      >
        <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
      </button>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />

      {open && (
        <div className={cn(
          "absolute left-0 min-w-full z-50 rounded-lg border border-white/5 bg-zinc-900/95 backdrop-blur-xl shadow-2xl p-1",
          upward ? "bottom-full mb-1" : "top-full mt-1"
        )}>
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                "w-full text-left px-3 py-1.5 text-xs rounded-md transition-colors",
                value === option.value
                  ? "bg-blue-500/10 text-blue-400"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
