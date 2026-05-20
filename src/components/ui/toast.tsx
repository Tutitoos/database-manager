import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastLevel = "info" | "success" | "warn" | "danger";

export interface ToastInput {
  id?: string;
  title?: string;
  body?: string;
  level?: ToastLevel;
  ttl?: number;
  action?: { label: string; onClick: () => void };
  onClick?: () => void;
}

export interface ToastItem extends Required<Omit<ToastInput, "ttl" | "action" | "onClick">> {
  ttl: number;
  action?: { label: string; onClick: () => void };
  onClick?: () => void;
}

interface ToastCtx {
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

const ICONS: Record<ToastLevel, typeof CheckCircle2> = {
  info: Info,
  success: CheckCircle2,
  warn: AlertTriangle,
  danger: XCircle,
};

const COLORS: Record<ToastLevel, string> = {
  info: "border-info/30 bg-info-soft text-info",
  success: "border-success/30 bg-success-soft text-success",
  warn: "border-warn/30 bg-warn-soft text-warn",
  danger: "border-danger/30 bg-danger-soft text-danger",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput): string => {
      const id = input.id ?? `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const next: ToastItem = {
        id,
        title: input.title ?? "",
        body: input.body ?? "",
        level: input.level ?? "info",
        ttl: input.ttl ?? 3500,
        action: input.action,
        onClick: input.onClick,
      };
      setItems((prev) => [...prev, next].slice(-6));
      if (next.ttl > 0) {
        window.setTimeout(() => dismiss(id), next.ttl);
      }
      return id;
    },
    [dismiss],
  );

  // Register the singleton so pushToast() works from non-React modules.
  useEffect(() => {
    _registerEnqueue(toast);
    return () => _registerEnqueue(() => "");
  }, [toast]);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[120] flex w-80 flex-col gap-2">
        {items.map((t) => {
          const Icon = ICONS[t.level];
          return (
            <div
              key={t.id}
              onClick={t.onClick}
              className={cn(
                "pointer-events-auto flex items-start gap-2 rounded-md border bg-surface-overlay px-3 py-2 shadow-md backdrop-blur animate-[toast-in_180ms_ease-out]",
                COLORS[t.level],
                t.onClick && "cursor-pointer",
              )}
            >
              <Icon strokeWidth={1.5} className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1 text-body">
                {t.title && <p className="font-semibold text-text">{t.title}</p>}
                {t.body && <p className="mt-0.5 text-text-muted">{t.body}</p>}
                {t.action && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      t.action!.onClick();
                      dismiss(t.id);
                    }}
                    className="text-body mt-1.5 inline-flex h-6 items-center rounded-md border border-current/30 bg-current/10 px-2 font-medium text-text hover:bg-current/20"
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss(t.id);
                }}
                className="shrink-0 rounded-sm text-text-faint transition-colors hover:text-text"
              >
                <X strokeWidth={1.5} className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Fallback when not wrapped — no-op for tests or boot-time guards.
    return { toast: () => "", dismiss: () => undefined };
  }
  return ctx;
}

/** Singleton accessor for use outside of React components.
 *  Resolved lazily once a provider mounts. */
let _enqueue: ((input: ToastInput) => string) | null = null;
export function _registerEnqueue(fn: (input: ToastInput) => string) {
  _enqueue = fn;
}
export function pushToast(input: ToastInput): string {
  return _enqueue?.(input) ?? "";
}
