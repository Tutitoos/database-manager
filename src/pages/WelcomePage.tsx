import { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { HardDrive, Cloud, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pushToast } from "@/components/ui/toast";
import { AddOrgWizard } from "@/components/shell/AddOrgWizard";
import { addOrg, setActiveOrg, refreshOrgs } from "@/store/orgs";
import { appBg } from "@/lib/styles";
import { cn } from "@/lib/utils";

type Step = "choose" | "local-config" | "remote";

interface DerivedToken { token: string; hash: string }

/** First-run gate. No orgs configured → user picks Local or Remote.
 *  Local path: configure port + persistence → spawn the embedded server
 *  with a random admin bearer → create the "Local" org → done.
 *  No passphrase — auth is biometry (optional) or just the stored bearer. */
export function WelcomePage({ onReady }: { onReady: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("choose");
  const [port, setPort] = useState(18787);
  const [persistent, setPersistent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finishLocal() {
    setBusy(true);
    setError(null);
    try {
      // Random bearer (32 bytes b64) + Argon2id hash. Replaces the old
      // passphrase-derived flow — same crypto shape, but the secret lives
      // in the OS keychain instead of a user-memorized passphrase.
      const derived = await invoke<DerivedToken>("gen_local_admin_token");
      await invoke("start_local_server", {
        options: { port, lan: false, admin_token_hash: derived.hash, persistent },
      });
      await invoke("set_app_setting", {
        key: "local.admin_token",
        valueJson: JSON.stringify(derived.token),
      });
      const created = await addOrg({
        name: "Local",
        server_url: `http://127.0.0.1:${port}`,
        server_kind: "local",
        accent_color: null,
        icon_url: null,
        version: null,
        cert_fingerprint: null,
      });
      try { await invoke("set_org_remote_id", { orgId: created.id, remoteId: "org_local" }); } catch { /* ignore */ }
      await refreshOrgs();
      await setActiveOrg(created.id);
      try { await invoke("auth_create_local_user", { token: derived.token }); } catch { /* ignore */ }
      pushToast({ level: "success", title: t("welcome.localReadyToast") });
      onReady();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (step === "remote") {
    return <AddOrgWizard onClose={() => { void refreshOrgs().then(onReady); }} />;
  }

  return (
    <main data-tauri-drag-region className={cn("grid h-screen place-items-center px-4 text-text", appBg)}>
      <section
        data-tauri-drag-region="false"
        className="w-full max-w-md space-y-5 rounded-xl border border-border-subtle bg-surface-overlay p-6 shadow-md"
      >
        <header>
          <h1 className="text-page-title text-text">{t("welcome.title")}</h1>
          <p className="text-caption mt-1 text-text-muted">{t("welcome.subtitle")}</p>
        </header>

        {step === "choose" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setStep("local-config")}
              className="flex flex-col items-start gap-2 rounded-lg border border-border-subtle bg-surface-elevated p-4 text-left transition-colors hover:border-accent hover:bg-surface-hover"
            >
              <HardDrive className="h-5 w-5 text-accent" />
              <span className="text-body font-medium">{t("welcome.localTitle")}</span>
              <span className="text-caption text-text-muted">{t("welcome.localBody")}</span>
            </button>
            <button
              type="button"
              onClick={() => setStep("remote")}
              className="flex flex-col items-start gap-2 rounded-lg border border-border-subtle bg-surface-elevated p-4 text-left transition-colors hover:border-accent hover:bg-surface-hover"
            >
              <Cloud className="h-5 w-5 text-accent" />
              <span className="text-body font-medium">{t("welcome.remoteTitle")}</span>
              <span className="text-caption text-text-muted">{t("welcome.remoteBody")}</span>
            </button>
          </div>
        )}

        {step === "local-config" && (
          <div className="space-y-3">
            <div>
              <label className="text-overline mb-1 block">{t("welcome.portLabel")}</label>
              <Input
                type="number"
                value={port}
                min={1024}
                max={65535}
                onChange={(e) => setPort(Number(e.target.value) || 18787)}
              />
              <p className="text-caption mt-1 text-text-faint">{t("welcome.portHelp")}</p>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-body text-text-muted">
              <input
                type="checkbox"
                checked={persistent}
                onChange={(e) => setPersistent(e.target.checked)}
                className="h-4 w-4 accent-accent"
              />
              <span>{t("welcome.persistentLabel")}</span>
            </label>
            {error && <p className="text-body text-danger">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setStep("choose")} disabled={busy}>
                {t("common.back")}
              </Button>
              <Button variant="primary" onClick={finishLocal} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("welcome.startLocal")}
              </Button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
