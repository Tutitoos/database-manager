import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Server } from "lucide-react";
import { useNavigate } from "@/lib/router-compat";
import { Button } from "@/components/ui/button";
import { AddOrgWizard } from "@/components/shell/AddOrgWizard";
import { useOrgs } from "@/store/orgs";
import { currentUser } from "@/lib/auth";
import { panel } from "@/lib/styles";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { orgs } = useOrgs();
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await currentUser();
      if (!cancelled && me) navigate("/settings/account", { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const remoteOrgs = orgs.filter((o) => o.server_kind !== "local");

  return (
    <>
      <div data-tauri-drag-region className={cn("flex min-h-screen items-center justify-center", panel)}>
        <div
          data-tauri-drag-region="false"
          className="w-full max-w-md space-y-6 rounded-xl border border-border-subtle bg-surface-overlay p-8 shadow-md"
        >
          <div>
            <h1 className="text-page-title text-text">{t("login.title")}</h1>
            <p className="text-caption mt-1 text-text-muted">{t("login.subtitle")}</p>
          </div>

          <div className="space-y-3">
            <p className="text-body text-text-muted">{t("login.orgFlowHint")}</p>
            <Button onClick={() => setWizardOpen(true)} className="w-full justify-center">
              <Plus className="h-4 w-4" />
              {t("login.addOrg")}
            </Button>
          </div>

          {remoteOrgs.length > 0 && (
            <div className="space-y-2">
              <p className="text-overline">{t("login.existingOrgs")}</p>
              <ul className="space-y-1">
                {remoteOrgs.map((o) => (
                  <li
                    key={o.id}
                    className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-elevated px-3 py-2 text-body"
                  >
                    <Server className="h-3.5 w-3.5 text-text-faint" />
                    <span className="flex-1 truncate">{o.name}</span>
                    <span className="text-tiny text-text-faint">{o.server_url ?? "—"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="w-full justify-center">
            {t("login.back")}
          </Button>
        </div>
      </div>
      {wizardOpen && <AddOrgWizard onClose={() => setWizardOpen(false)} />}
    </>
  );
}
