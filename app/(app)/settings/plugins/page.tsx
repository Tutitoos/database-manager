"use client";

import { invoke } from "@tauri-apps/api/core";
import { Boxes, CheckCircle2, Loader2, Plug, RefreshCw, Search, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getProviderUi, ProviderIcon } from "@/lib/providers";
import { hoverSurface, mutedText, sectionBorder, softText, surface } from "@/lib/styles";
import type { PluginInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-4">
      <div className="text-xl font-semibold tracking-[-.02em] text-white">{value}</div>
      <div className={cn("mt-1 text-xs", mutedText)}>{label}</div>
    </div>
  );
}

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [pluginsTab, setPluginsTab] = useState<"instalados" | "marketplace">("instalados");

  const enabled = plugins.filter((p) => p.enabled).length;

  async function refresh() {
    const next = await invoke<PluginInfo[]>("list_plugins");
    setPlugins(next);
  }

  useEffect(() => {
    refresh().catch(console.error);
  }, []);

  async function rescanPlugins() {
    setBusy(true);
    try {
      await invoke("rescan_plugins");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setPluginEnabled(plugin: PluginInfo, value: boolean) {
    try {
      await invoke(value ? "enable_plugin" : "disable_plugin", { pluginId: plugin.id });
      await refresh();
    } catch {
      await refresh();
    }
  }

  return (
    <>
      <div className={cn("rounded-lg", surface)}>
        <div className={cn("flex items-center justify-between border-b p-5", sectionBorder)}>
          <div className="flex items-center gap-4">
            <div className="grid h-9 w-9 place-items-center rounded-md border border-zinc-700/70 bg-[#101010] text-zinc-200">
              <Plug className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-[-.01em] text-white">Centro de plugins</h1>
              <p className={cn("text-xs", mutedText)}>Instala extensiones, gestiona drivers y mantén bajo control la ejecución.</p>
            </div>
          </div>
          <Button onClick={rescanPlugins} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Actualizar
          </Button>
        </div>
        <div className="grid grid-cols-3 divide-x divide-zinc-900">
          <Metric label="Instalados" value={plugins.length} />
          <Metric label="Habilitados" value={enabled} />
          <Metric label="Registro local" value={plugins.length} />
        </div>
      </div>

      <div className={cn("mt-5 flex h-10 items-end gap-5 border-b", sectionBorder)}>
        <button
          onClick={() => setPluginsTab("instalados")}
          className={cn("flex items-center gap-1.5 border-b-2 pb-2 text-xs font-medium transition-colors", pluginsTab === "instalados" ? "border-blue-500 text-white" : "border-transparent text-zinc-500 hover:text-zinc-300")}
        >
          <Plug className="h-3.5 w-3.5" />
          Instalados
        </button>
        <button
          onClick={() => setPluginsTab("marketplace")}
          className={cn("flex items-center gap-1.5 border-b-2 pb-2 text-xs font-medium transition-colors", pluginsTab === "marketplace" ? "border-blue-500 text-white" : "border-transparent text-zinc-500 hover:text-zinc-300")}
        >
          <Boxes className="h-3.5 w-3.5" />
          Marketplace
        </button>
      </div>

      {pluginsTab === "marketplace" && (
        <div className="mt-10 flex flex-col items-center justify-center py-16 text-center">
          <div className="grid h-10 w-10 place-items-center rounded-md border border-zinc-700/70 bg-[#101010] text-zinc-400">
            <Boxes className="h-5 w-5" />
          </div>
          <h2 className="mt-4 text-sm font-medium text-white">Próximamente</h2>
          <p className={cn("mt-1 max-w-sm text-xs", mutedText)}>El marketplace de plugins estará disponible en una próxima versión.</p>
        </div>
      )}

      {pluginsTab === "instalados" && <>
        <div className="mt-7 flex items-center justify-between">
          <div>
            <p className={cn("text-[10px] font-semibold uppercase tracking-[.16em]", mutedText)}>Plugins disponibles</p>
            <p className={cn("text-xs", softText)}>Explora plugins detectados en la carpeta local.</p>
          </div>
          <div className="relative w-56">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
            <Input className="pl-9" placeholder="Buscar plugins..." />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {plugins.map((plugin) => (
            <article key={plugin.id} className={cn("overflow-hidden rounded-lg", surface, hoverSurface)}>
              <div className={cn("flex items-center gap-3 border-b p-4", sectionBorder)}>
                <div className="grid h-8 w-8 place-items-center rounded-md text-white" style={{ backgroundColor: getProviderUi(plugin.id, plugin.manifest).color }}>
                  <ProviderIcon providerId={plugin.id} className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-white">{plugin.name}</h3>
                  <p className={cn("truncate text-xs", mutedText)}>v{plugin.version}</p>
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className={cn("text-xs", mutedText)}>{plugin.description}</p>
                  {plugin.loaded ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-zinc-500" />}
                </div>
                {plugin.error && (
                  <div className="mt-3 rounded-md border border-red-900/60 bg-red-950/20 p-2 text-xs text-red-200">
                    <p>{plugin.error}</p>
                    {plugin.error.includes("EOF") && (
                      <p className="mt-1 text-red-400/80">Ejecuta <code className="font-mono">pnpm plugins:build</code> para recompilar los plugins.</p>
                    )}
                  </div>
                )}
              </div>
              <div className={cn("flex items-center justify-between border-t px-4 py-3", sectionBorder)}>
                <span className="max-w-[70%] truncate text-xs text-zinc-500">{plugin.path}</span>
                <div className="flex items-center gap-3">
                  <span className={cn("text-xs", softText)}>{plugin.enabled ? "Activo" : "Inactivo"}</span>
                  <Switch checked={plugin.enabled} onCheckedChange={(checked) => setPluginEnabled(plugin, checked)} />
                </div>
              </div>
            </article>
          ))}
        </div>
      </>}
    </>
  );
}
