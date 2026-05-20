import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Cloud, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { pushToast } from "@/components/ui/toast";
import { fetchOrgHealth, useOrgs } from "@/store/orgs";
import { onDeepLink, extractAuthCode, type OAuthProvider } from "@/lib/auth";
import { ProviderBrandIcon } from "@/lib/providers";
import { appBg } from "@/lib/styles";
import { cn } from "@/lib/utils";

/** Mandatory login screen shown when the active org is remote AND there is
 *  no `app_user` row yet. Blocks Shell mounting until OAuth completes. */
export function AuthRequiredGate({ onAuthed }: { onAuthed: () => void }) {
  const { t } = useTranslation();
  const { orgs, activeId } = useOrgs();
  const active = orgs.find((o) => o.id === activeId) ?? null;
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Providers actually configured on this server. Fallback to empty until
  // we can fetch `/health`. Filtering here avoids the "client id not
  // configured" page when the server is the local sidecar that ships
  // without OAuth keys.
  const [providers, setProviders] = useState<string[]>([]);
  const [localBootstrapping, setLocalBootstrapping] = useState(false);
  // Latest onAuthed ref so the bootstrap effect doesn't re-run every parent
  // render (parent re-creates the callback inline → infinite mount loop).
  const onAuthedRef = useRef(onAuthed);
  useEffect(() => { onAuthedRef.current = onAuthed; }, [onAuthed]);

  useEffect(() => {
    if (!active?.server_url) return;
    let cancelled = false;
    // "Local-like" orgs never require OAuth — they get a synthetic `__local__`
    // user backed by a random bearer in `local.admin_token`. We detect them by
    // either the explicit `server_kind === "local"` tag OR a URL that points
    // at a loopback host. The latter covers legacy installs where the user
    // added their own sidecar via AddOrgWizard so the row ended up tagged
    // `manual`. If the gate is ever reached for a local-like org it means the
    // bootstrap path in main.tsx didn't run; fix it here as belt-and-braces
    // so the user isn't trapped.
    const url = active.server_url;
    const isLoopback = (() => {
      try {
        const h = new URL(url).hostname;
        return h === "localhost" || h === "127.0.0.1" || h === "::1";
      } catch { return false; }
    })();
    const isLocalLike = active.server_kind === "local" || isLoopback;
    if (isLocalLike) {
      setLocalBootstrapping(true);
      (async () => {
        try {
          const raw = await invoke<string | null>("get_app_setting", { key: "local.admin_token" });
          let token = raw ? (JSON.parse(raw) as string) : null;
          if (!token) {
            const derived = await invoke<{ token: string; hash: string }>("gen_local_admin_token");
            await invoke("set_app_setting", {
              key: "local.admin_token",
              valueJson: JSON.stringify(derived.token),
            });
            try {
              await invoke("local_server_setup_admin", {
                serverUrl: active.server_url,
                hash: derived.hash,
              });
            } catch { /* 409 already configured, or unreachable */ }
            token = derived.token;
          }
          await invoke("auth_create_local_user", { token });
          // Verify the user row really lands before signalling. Otherwise the
          // boot watcher re-evaluates, finds no user, and bounces us straight
          // back into the gate — that's the login/home flicker loop.
          const user = await invoke<unknown>("auth_current_user").catch(() => null);
          if (cancelled) return;
          if (user) {
            onAuthedRef.current();
          } else {
            setError("Local bootstrap completed but user row missing — try restarting the app.");
            setLocalBootstrapping(false);
          }
        } catch (e) {
          if (!cancelled) {
            setError(String(e));
            setLocalBootstrapping(false);
          }
        }
      })();
      return () => { cancelled = true; };
    }
    fetchOrgHealth(active.server_url)
      .then((h) => { if (!cancelled) setProviders(h.providers ?? []); })
      .catch(() => { if (!cancelled) setProviders([]); });
    return () => { cancelled = true; };
  }, [active?.server_url, active?.server_kind]);

  // Listen for the OAuth deep-link callback. When the server returns the
  // code, exchange it via `auth_complete_oauth` (cert-pinned) and signal
  // the parent so the boot phase advances to "ready".
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await onDeepLink(async (url) => {
        const code = extractAuthCode(url);
        if (!code || !active?.server_url) return;
        try {
          await invoke("auth_complete_oauth", {
            serverUrl: active.server_url,
            code,
            pinned: active.cert_fingerprint ?? null,
          });
          pushToast({ level: "success", title: t("auth.signedInToast") });
          onAuthedRef.current();
        } catch (e) {
          setError(String(e));
          setBusy(null);
        }
      });
    })();
    return () => unlisten?.();
  }, [active, t]);

  async function start(provider: OAuthProvider) {
    if (!active?.server_url) return;
    setBusy(provider);
    setError(null);
    try {
      const url = await invoke<string>("auth_start_oauth", {
        provider,
        serverUrl: active.server_url,
      });
      await openExternal(url);
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  }

  return (
    <main data-tauri-drag-region className={cn("grid h-screen place-items-center px-4 text-text", appBg)}>
      <section
        data-tauri-drag-region="false"
        className="w-full max-w-md space-y-4 rounded-xl border border-border-subtle bg-surface-overlay p-6 shadow-md"
      >
        <div className="flex items-start gap-3">
          <Cloud className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <div className="space-y-1">
            <h1 className="text-page-title text-text">{t("auth.requiredTitle")}</h1>
            <p className="text-caption text-text-muted">
              {t("auth.requiredBody", { name: active?.name ?? "?" })}
            </p>
          </div>
        </div>

        {localBootstrapping ? (
          <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent-soft/40 p-3 text-body">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
            <p className="text-text-muted">Inicializando server local…</p>
          </div>
        ) : providers.length === 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn-soft p-3 text-body">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
            <p className="text-text-muted">{t("auth.noProviders")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {providers.map((p) => (
              <Button
                key={p}
                variant="secondary"
                onClick={() => start(p as OAuthProvider)}
                disabled={busy !== null}
                className="justify-center capitalize"
              >
                {busy === p ? <Loader2 className="h-4 w-4 animate-spin" /> : <ProviderBrandIcon provider={p} className="h-4 w-4" />}
                {t("auth.continueWith", { provider: p })}
              </Button>
            ))}
          </div>
        )}

        {error && <p className="text-body text-danger">{error}</p>}
      </section>
    </main>
  );
}
