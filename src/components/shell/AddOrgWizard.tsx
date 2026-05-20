import { AlertTriangle, ArrowRight, Cloud, Globe, Loader2, Radar, Server } from "lucide-react";
import { ProviderBrandIcon } from "@/lib/providers";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pushToast } from "@/components/ui/toast";
import { addOrg, fetchOrgHealth, setActiveOrg, type OrgHealth } from "@/store/orgs";
import { extractAuthCode, type OAuthProvider } from "@/lib/auth";
import { cn } from "@/lib/utils";

type Step = "input" | "preview" | "login";

interface Discovered {
  instance: string;
  host: string;
  port: number;
  url: string;
  name?: string | null;
  version?: string | null;
}

export function AddOrgWizard({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("input");
  const [serverUrl, setServerUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<OrgHealth | null>(null);
  const [discovered, setDiscovered] = useState<Discovered[]>([]);

  // Start mDNS browse while the wizard is open.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void invoke("start_org_discovery").catch(() => undefined);
    void listen<Discovered>("org-discovered", (event) => {
      setDiscovered((prev) => {
        if (prev.some((d) => d.instance === event.payload.instance)) return prev;
        return [...prev, event.payload];
      });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
      void invoke("stop_org_discovery").catch(() => undefined);
    };
  }, []);

  async function loadHealth() {
    await loadHealthFor(serverUrl);
  }
  async function loadHealthFor(url: string) {
    if (!url.trim()) {
      setError("Introduce una IP o dominio.");
      return;
    }
    setBusy(true);
    setError(null);
    // Try the URL as the user typed it; if it fails on an explicit scheme,
    // retry with the other one. LAN bind forces TLS server-side (self-signed)
    // while loopback runs plain HTTP — without this fallback the user has to
    // guess which scheme the discovered server is on.
    const trimmed = url.trim().replace(/\/+$/, "");
    const hasScheme = /^https?:\/\//i.test(trimmed);
    const attempts: string[] = hasScheme
      ? [trimmed, trimmed.replace(/^http:\/\//i, "https://").replace(/^https:\/\//i, (m) => trimmed.startsWith("https") ? "http://" : m)]
      : [`https://${trimmed}`, `http://${trimmed}`];
    // Dedupe (case where the swap yields the same string).
    const unique = Array.from(new Set(attempts));
    let lastErr: string | null = null;
    for (const candidate of unique) {
      try {
        const h = await fetchOrgHealth(candidate);
        setHealth(h);
        setServerUrl(candidate);
        setStep("preview");
        setBusy(false);
        return;
      } catch (e) {
        lastErr = String(e);
      }
    }
    setError(lastErr ?? "No se pudo conectar.");
    setBusy(false);
  }

  async function loginWithProvider(provider: OAuthProvider) {
    if (!health) return;
    setBusy(true);
    setError(null);
    try {
      const normalized = normalizeUrl(serverUrl);
      const url = await invoke<string>("auth_start_oauth", { provider, serverUrl: normalized });
      await openExternal(url);
      // Wait for deep-link callback (auth:deep-link event with `code`).
      const code = await waitForAuthCode();
      const user = await invoke<{ email: string; user_id: string }>("auth_complete_oauth", {
        serverUrl: normalized,
        code,
        pinned: health.cert_fingerprint ?? null,
      });
      const created = await addOrg({
        name: health.name,
        server_url: normalized,
        server_kind: "manual",
        accent_color: health.accent_color ?? null,
        icon_url: health.icon_url ?? null,
        version: health.version ?? null,
        cert_fingerprint: health.cert_fingerprint ?? null,
        user_email: user.email,
        user_id: user.user_id,
        role: "member",
      });
      await setActiveOrg(created.id);
      pushToast({ level: "success", title: t("orgs.wizard.addedToast"), body: created.name });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border-subtle bg-surface-overlay p-5 shadow-md">
        <header className="mb-4 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-md border border-border-subtle bg-surface-elevated text-accent">
            <Cloud strokeWidth={1.5} className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-h3 font-semibold text-text">{t("orgs.wizard.title")}</h2>
            <p className="text-[11px] text-text-muted">
              {step === "input" && t("orgs.wizard.stepInput")}
              {step === "preview" && t("orgs.wizard.stepPreview")}
              {step === "login" && t("orgs.wizard.stepLogin")}
            </p>
          </div>
        </header>

        <Stepper step={step} />

        {step === "input" && (
          <div className="mt-4 flex flex-col gap-3">
            {discovered.length > 0 && (
              <div className="rounded-md border border-border-subtle bg-surface-elevated p-2">
                <p className="mb-1 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-text-faint">
                  <Radar strokeWidth={1.5} className="h-3 w-3" /> {t("orgs.wizard.discovered")}
                </p>
                <div className="flex flex-col">
                  {discovered.map((d) => (
                    <button
                      key={d.instance}
                      type="button"
                      onClick={() => {
                        setServerUrl(d.url);
                        void loadHealthFor(d.url);
                      }}
                      className="flex items-center gap-2 rounded-sm px-2 py-1 text-left text-body text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
                    >
                      <Server strokeWidth={1.5} className="h-3 w-3 shrink-0 text-accent" />
                      <span className="min-w-0 flex-1">
                        <span className="truncate text-text">{d.name ?? d.instance}</span>
                        <span className="ml-1 text-text-faint">{d.host}:{d.port}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label className="flex flex-col gap-1.5 text-body text-text-muted">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">
                IP o dominio
              </span>
              <div className="relative">
                <Globe strokeWidth={1.5} className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
                <Input
                  type="text"
                  placeholder={t("orgs.wizard.addressPlaceholder")}
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !busy && loadHealth()}
                  className="pl-8"
                  autoFocus
                />
              </div>
            </label>
            {error && <ErrorBox text={error} />}
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
                {t("orgs.wizard.cancel")}
              </Button>
              <Button variant="primary" size="sm" onClick={loadHealth} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />}
                {t("orgs.wizard.next")}
              </Button>
            </div>
          </div>
        )}

        {step === "preview" && health && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex items-center gap-3 rounded-md border border-border-subtle bg-surface-elevated p-3">
              <span
                className="grid h-10 w-10 place-items-center rounded-md text-white"
                style={{ background: health.accent_color ?? "#0ea5e9" }}
              >
                <Server strokeWidth={1.5} className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-h3 font-semibold text-text">{health.name}</p>
                <p className="truncate text-[11px] text-text-muted">
                  {normalizeUrl(serverUrl)}
                  {health.version && ` · v${health.version}`}
                </p>
              </div>
            </div>
            {error && <ErrorBox text={error} />}
            {(!health.providers || health.providers.length === 0) && (
              <div className="rounded-md border border-amber-900/40 bg-amber-950/30 p-3 text-[11px] text-amber-200">
                <AlertTriangle strokeWidth={1.5} className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />
                {t("orgs.wizard.noProviders")}
              </div>
            )}
            <div className="mt-2 flex justify-between">
              <Button variant="ghost" size="sm" onClick={() => setStep("input")}>
                {t("orgs.wizard.back")}
              </Button>
              <div className="flex gap-2">
                {(!health.providers || health.providers.length === 0) ? (
                  // No OAuth providers configured on the server. The org
                  // can't be joined — login is mandatory now.
                  <span className="text-caption text-danger">
                    {t("orgs.wizard.noProvidersBlock")}
                  </span>
                ) : (
                  <Button variant="primary" size="sm" onClick={() => setStep("login")} disabled={busy}>
                    {t("orgs.wizard.signInToServer")}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {step === "login" && health && (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-[11px] text-text-muted">
              {t("orgs.wizard.selectProvider", { name: health.name })}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(health.providers ?? []).map((p) => (
                <Button
                  key={p}
                  variant="secondary"
                  size="md"
                  onClick={() => loginWithProvider(p as OAuthProvider)}
                  disabled={busy}
                  className="justify-start capitalize"
                >
                  <ProviderBrandIcon provider={p} className="h-4 w-4" />
                  {p}
                </Button>
              ))}
            </div>
            {error && <ErrorBox text={error} />}
            <div className="mt-2 flex justify-between">
              <Button variant="ghost" size="sm" onClick={() => setStep("preview")}>
                Atrás
              </Button>
              {busy && (
                <div className="flex items-center gap-2 text-[11px] text-text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Esperando autenticación…
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Stepper({ step }: { step: Step }) {
  const order: Step[] = ["input", "preview", "login"];
  const idx = order.indexOf(step);
  return (
    <div className="flex items-center gap-2">
      {order.map((s, i) => (
        <div key={s} className="flex flex-1 items-center gap-2">
          <span
            className={cn(
              "grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold",
              i <= idx ? "bg-accent text-text-on-accent" : "bg-surface-sunken text-text-faint",
            )}
          >
            {i + 1}
          </span>
          {i < order.length - 1 && (
            <span
              className={cn("h-px flex-1", i < idx ? "bg-accent" : "bg-border-subtle")}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ErrorBox({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-danger/40 bg-danger-soft p-2.5 text-[11px] text-danger">
      {text}
    </div>
  );
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function waitForAuthCode(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      unlisten?.();
      reject(new Error("Tiempo de espera agotado para la autenticación"));
    }, 5 * 60_000);
    let unlisten: (() => void) | undefined;
    void listen<string[]>("auth:deep-link", (event) => {
      for (const url of event.payload ?? []) {
        const code = extractAuthCode(url);
        if (code) {
          window.clearTimeout(timeout);
          unlisten?.();
          resolve(code);
          return;
        }
      }
    }).then((fn) => {
      unlisten = fn;
    });
  });
}
