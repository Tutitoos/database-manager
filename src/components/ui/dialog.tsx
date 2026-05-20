"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/modal";

export function Dialog({ open, title, children, onOpenChange }: { open: boolean; title: string; children: React.ReactNode; onOpenChange: (open: boolean) => void }) {
  if (!open) return null;

  return (
    <Modal onClose={() => onOpenChange(false)}>
      <div className="w-full max-w-xl rounded-lg border border-border-strong bg-[#0f0f10] shadow-[0_24px_80px_rgba(0,0,0,.65)]">
        <div className="flex h-12 items-center justify-between border-b border-border-subtle px-5">
          <h2 className="text-h3 font-semibold text-text">{title}</h2>
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="Cerrar">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </Modal>
  );
}
