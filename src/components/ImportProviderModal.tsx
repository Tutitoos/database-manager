import { Database, FileJson, Lock } from "lucide-react";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { IMPORT_PROVIDERS, type ImportProviderInfo, type ImportSource } from "@/lib/import";
import { cn } from "@/lib/utils";

interface Props {
  onClose: () => void;
  onSelect: (provider: ImportProviderInfo) => void;
}

export function ImportProviderModal({ onClose, onSelect }: Props) {
  return (
    <Modal onClose={onClose}>
      <div className="w-full max-w-lg space-y-4 rounded-xl border border-border-subtle bg-surface-overlay p-5 shadow-md">
        <header className="space-y-1">
          <h2 className="text-h2 text-text">Importar conexiones</h2>
          <p className="text-body text-text-muted">
            Elige desde dónde vienen los datos. Luego se abrirá el diálogo de archivo.
          </p>
        </header>

        <div className="grid gap-2">
          {IMPORT_PROVIDERS.map((p) => (
            <button
              key={p.source}
              type="button"
              onClick={() => onSelect(p)}
              className={cn(
                "flex items-start gap-3 rounded-lg border border-border-subtle bg-surface-elevated p-3 text-left transition-colors hover:bg-surface-hover",
              )}
            >
              <ProviderIcon source={p.source} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-body font-medium text-text">{p.label}</span>
                  {p.encrypted && (
                    <span className="text-tiny inline-flex items-center gap-1 rounded-sm bg-warn-soft px-1.5 py-0.5 font-semibold uppercase tracking-wider text-warn">
                      <Lock className="h-3 w-3" />
                      Encriptado
                    </span>
                  )}
                </div>
                <p className="text-caption mt-0.5 text-text-muted">{p.description}</p>
              </div>
            </button>
          ))}
        </div>

        <footer className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
        </footer>
      </div>
    </Modal>
  );
}

function ProviderIcon({ source }: { source: ImportSource }) {
  const Icon = source === "datagrip" ? Database : FileJson;
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border-subtle bg-surface text-text">
      <Icon strokeWidth={1.5} className="h-4 w-4" />
    </span>
  );
}
