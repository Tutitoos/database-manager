import { Keyboard, RotateCcw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pushToast } from "@/components/ui/toast";
import { Modal } from "@/components/modal";
import { SettingsCard, SettingsRow } from "@/components/settings/SettingsCard";
import {
  CATEGORIES,
  SHORTCUTS,
  eventToKeys,
  type ShortcutCategory,
  type ShortcutDef,
} from "@/lib/shortcut-registry";
import { loadSettings, setSetting, useSettings } from "@/store/settings";
import { useDebounced } from "@/lib/use-debounce";
import { cn } from "@/lib/utils";

export default function ShortcutsPage() {
  const { t } = useTranslation();
  const s = useSettings();
  const [query, setQuery] = useState("");
  const [capturing, setCapturing] = useState<ShortcutDef | null>(null);

  useEffect(() => { void loadSettings(); }, []);

  const debounced = useDebounced(query, 180);

  function resolvedKeys(def: ShortcutDef): string[] {
    const override = s.shortcutOverrides?.[def.id];
    return override && override.length > 0 ? override : def.defaultKeys;
  }

  function isCustom(def: ShortcutDef): boolean {
    const override = s.shortcutOverrides?.[def.id];
    return !!(override && override.length > 0);
  }

  async function resetOne(def: ShortcutDef) {
    const next = { ...s.shortcutOverrides };
    delete next[def.id];
    await setSetting("shortcutOverrides", next);
  }

  async function resetAll() {
    await setSetting("shortcutOverrides", {});
    pushToast({ level: "info", title: t("shortcuts.resetAll") });
  }

  async function saveCapture(keys: string[]) {
    if (!capturing) return;
    const next = { ...s.shortcutOverrides, [capturing.id]: keys };
    await setSetting("shortcutOverrides", next);
    setCapturing(null);
    pushToast({ level: "success", title: capturing.id, body: keys.join(" + ") });
  }

  const grouped = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    const out: Record<ShortcutCategory, ShortcutDef[]> = {
      navigation: [], tabs: [], query: [], view: [], window: [],
    };
    for (const def of SHORTCUTS) {
      if (q) {
        const label = t(`shortcuts.actions.${def.labelKey}`).toLowerCase();
        if (!label.includes(q) && !def.id.toLowerCase().includes(q)) continue;
      }
      out[def.category].push(def);
    }
    return out;
  }, [debounced, t]);

  const totalCustom = Object.keys(s.shortcutOverrides ?? {}).length;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 pb-12">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg border border-border-subtle bg-surface-elevated text-text">
            <Keyboard strokeWidth={1.5} className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-h1 text-text">{t("shortcuts.title")}</h1>
            <p className="text-caption text-text-muted">{t("shortcuts.subtitle")}</p>
          </div>
        </div>
        {totalCustom > 0 && (
          <Button variant="secondary" size="sm" onClick={resetAll}>
            <RotateCcw className="h-3.5 w-3.5" /> {t("shortcuts.resetAll")}
          </Button>
        )}
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-text-faint" />
        <Input
          placeholder={t("shortcuts.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 pl-8 text-body"
        />
      </div>

      {CATEGORIES.map((cat) => {
        const list = grouped[cat];
        if (!list || list.length === 0) return null;
        return (
          <SettingsCard key={cat} title={t(`shortcuts.categories.${cat}`)}>
            {list.map((def) => (
              <SettingsRow
                key={def.id}
                label={t(`shortcuts.actions.${def.labelKey}`)}
                description={
                  def.systemManaged
                    ? t("shortcuts.notes.rebindHelp")
                    : isCustom(def)
                      ? t("shortcuts.custom")
                      : t("shortcuts.default")
                }
                control={
                  <div className="flex items-center gap-2">
                    <KeyChord keys={resolvedKeys(def)} />
                    {!def.systemManaged && (
                      <>
                        <button
                          type="button"
                          onClick={() => setCapturing(def)}
                          className="text-caption rounded-md border border-border-subtle px-2 py-1 text-text-muted hover:bg-surface-hover hover:text-text"
                        >
                          {t("shortcuts.rebind")}
                        </button>
                        {isCustom(def) && (
                          <button
                            type="button"
                            onClick={() => resetOne(def)}
                            title={t("shortcuts.reset")}
                            className="grid h-7 w-7 place-items-center rounded-md text-text-faint hover:bg-surface-hover hover:text-text"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                }
              />
            ))}
          </SettingsCard>
        );
      })}

      <p className="text-caption text-text-faint">{t("shortcuts.notes.restartRequired")}</p>

      {capturing && (
        <CaptureModal
          def={capturing}
          onCancel={() => setCapturing(null)}
          onSave={saveCapture}
        />
      )}
    </div>
  );
}

function KeyChord({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k, i) => (
        <kbd
          key={i}
          className="text-body-mono inline-flex h-6 min-w-[24px] items-center justify-center rounded-md border border-border-subtle bg-surface-sunken px-1.5 text-text"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

function CaptureModal({
  def,
  onCancel,
  onSave,
}: {
  def: ShortcutDef;
  onCancel: () => void;
  onSave: (keys: string[]) => void;
}) {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<string[] | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      const k = eventToKeys(e);
      if (k) setKeys(k);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <Modal onClose={onCancel}>
      <div className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-overlay p-5">
        <h2 className="text-h2 text-text">{t(`shortcuts.actions.${def.labelKey}`)}</h2>
        <p className="text-body mt-1 text-text-muted">{t("shortcuts.pressKeys")}</p>
        <div className={cn(
          "mt-4 flex h-16 items-center justify-center rounded-md border-2 border-dashed",
          keys ? "border-accent bg-accent-soft" : "border-border-subtle bg-surface",
        )}>
          {keys ? <KeyChord keys={keys} /> : <span className="text-caption text-text-faint">…</span>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {t("shortcuts.cancel")}
          </Button>
          <Button variant="primary" size="sm" disabled={!keys} onClick={() => keys && onSave(keys)}>
            {t("shortcuts.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
