"use client";

import { Settings } from "lucide-react";
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { mutedText, sectionBorder, surface } from "@/lib/styles";
import { cn } from "@/lib/utils";

export default function GeneralPage() {
  const [confirmDelete, setConfirmDelete] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("setting:confirmDelete");
    return stored === null ? true : stored === "true";
  });

  function toggleConfirmDelete(value: boolean) {
    setConfirmDelete(value);
    localStorage.setItem("setting:confirmDelete", String(value));
  }

  return (
    <div>
      <div className={cn("rounded-lg", surface)}>
        <div className={cn("flex items-center gap-4 border-b p-5", sectionBorder)}>
          <div className="grid h-9 w-9 place-items-center rounded-md border border-zinc-700/70 bg-[#101010] text-zinc-200">
            <Settings className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-[-.01em] text-white">Ajustes generales</h1>
            <p className={cn("text-xs", mutedText)}>Configura el comportamiento global de la aplicación.</p>
          </div>
        </div>
      </div>

      <div className={cn("mt-5 rounded-lg", surface)}>
        <div className={cn("border-b px-5 py-3", sectionBorder)}>
          <p className={cn("text-[10px] font-semibold uppercase tracking-[.16em]", mutedText)}>Conexiones</p>
        </div>
        <div className={cn("flex items-center justify-between border-b px-5 py-4", sectionBorder)}>
          <div>
            <p className="text-sm text-white">Confirmar antes de eliminar</p>
            <p className={cn("mt-0.5 text-xs", mutedText)}>Muestra un diálogo de confirmación al eliminar una conexión.</p>
          </div>
          <Switch checked={confirmDelete} onCheckedChange={toggleConfirmDelete} />
        </div>
      </div>
    </div>
  );
}
