import { Database, Lock } from "lucide-react";
import { siDatagrip, siDbeaver } from "simple-icons";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { IMPORT_PROVIDERS, type ImportProviderInfo, type ImportSource } from "@/lib/import";
import { cn } from "@/lib/utils";

// Geometric mark taken verbatim from the official DataFlare logo
// (https://dataflare.app/_next/static/media/logo.7c1bcd2e.svg, 550×550 box).
const DATAFLARE_PATH =
  "M275 7L495.533 113.161L550 351.704L275 275.5L397.387 543H152.613L0 351.704L54.4671 113.161L275 275.5V7Z";

// TablePlus doesn't publish a flat-vector mark, so use the apple-touch-icon
// PNG that ships with their site. Loaded remotely on first paint and cached
// by the webview thereafter; falls back gracefully if offline (alt text).
const TABLEPLUS_ICON_URL = "https://tableplus.com/resources/favicons/apple-icon.png";

interface Props {
  onClose: () => void;
  onSelect: (provider: ImportProviderInfo) => void;
}

export function ImportProviderModal({ onClose, onSelect }: Props) {
  const { t } = useTranslation();
  return (
    <Modal onClose={onClose}>
      <div className="w-full max-w-lg space-y-4 rounded-xl border border-border-subtle bg-surface-overlay p-5 shadow-md">
        <header className="space-y-1">
          <h2 className="text-h2 text-text">{t("importModal.title")}</h2>
          <p className="text-body text-text-muted">{t("importModal.description")}</p>
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
                  <span className="text-body font-medium text-text">
                    {t(`importModal.providers.${p.source}.label` as const, { defaultValue: p.label })}
                  </span>
                  {p.encrypted && (
                    <span className="text-tiny inline-flex items-center gap-1 rounded-sm bg-warn-soft px-1.5 py-0.5 font-semibold uppercase tracking-wider text-warn">
                      <Lock className="h-3 w-3" />
                      {t("importModal.encrypted")}
                    </span>
                  )}
                </div>
                <p className="text-caption mt-0.5 text-text-muted">
                  {t(`importModal.providers.${p.source}.description` as const, { defaultValue: p.description })}
                </p>
              </div>
            </button>
          ))}
        </div>

        <footer className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}

function ProviderIcon({ source }: { source: ImportSource }) {
  switch (source) {
    case "dbeaver":
      return (
        <BrandTile
          viewBox="0 0 24 24"
          path={siDbeaver.path}
          bg={`#${siDbeaver.hex}`}
          title={siDbeaver.title}
        />
      );
    case "datagrip":
      // DataGrip's official mark is dark on light — render on the JetBrains
      // accent so the chip stays legible on the dark settings panel.
      return (
        <BrandTile viewBox="0 0 24 24" path={siDatagrip.path} bg="#22D88F" title={siDatagrip.title} />
      );
    case "dataflare":
      return (
        <BrandTile viewBox="0 0 550 550" path={DATAFLARE_PATH} bg="#1E293B" title="DataFlare" />
      );
    case "tableplus":
      return <ImageTile src={TABLEPLUS_ICON_URL} alt="TablePlus" />;
    case "native":
    default:
      return (
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border-subtle text-white"
          style={{ background: "#6366F1" }}
        >
          <Database strokeWidth={1.5} className="h-4 w-4" />
        </span>
      );
  }
}

function BrandTile({
  viewBox,
  path,
  bg,
  title,
}: {
  viewBox: string;
  path: string;
  bg: string;
  title: string;
}) {
  return (
    <span
      className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border-subtle"
      style={{ background: bg }}
    >
      <svg viewBox={viewBox} className="h-5 w-5" aria-label={title} role="img">
        <path d={path} fill="#ffffff" />
      </svg>
    </span>
  );
}

function ImageTile({ src, alt }: { src: string; alt: string }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-md border border-border-subtle bg-surface">
      <img src={src} alt={alt} className="h-full w-full object-cover" />
    </span>
  );
}
