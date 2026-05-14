"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Dialog({ open, title, children, onOpenChange }: { open: boolean; title: string; children: React.ReactNode; onOpenChange: (open: boolean) => void }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-6 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-lg border border-zinc-700/70 bg-[#0f0f10] shadow-[0_24px_80px_rgba(0,0,0,.65)]">
        <div className="flex h-12 items-center justify-between border-b border-zinc-800/80 px-5">
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="Cerrar">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
