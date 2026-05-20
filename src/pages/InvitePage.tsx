import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useSearchParams, useNavigate } from "@/lib/router-compat";
import { CloudOff, Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pushToast } from "@/components/ui/toast";
import { addOrg, fetchOrgHealth, refreshOrgs, setActiveOrg } from "@/store/orgs";

interface InviteInfo {
  org: { id: string; name: string; accent_color?: string | null; icon_url?: string | null };
  role: string;
}

export default function InvitePage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const serverUrl = params.get("server") ?? "";
  const inviteToken = params.get("token") ?? "";

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!serverUrl || !inviteToken) {
      setError(t("orgs.invitePage.invalidLink"));
      return;
    }
    (async () => {
      try {
        const data = await invoke<InviteInfo>("org_invite_info", { serverUrl, token: inviteToken });
        setInfo(data);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [serverUrl, inviteToken, t]);

  async function join() {
    if (!info) return;
    setBusy(true);
    setError(null);
    try {
      const result = await invoke<{ org_id: string; role: string }>("org_redeem_invite", {
        serverUrl,
        inviteToken,
      });
      const health = await fetchOrgHealth(serverUrl).catch(() => ({
        name: info.org.name,
        accent_color: info.org.accent_color ?? null,
        icon_url: info.org.icon_url ?? null,
        version: null,
        providers: [],
      } as { name: string; accent_color: string | null; icon_url: string | null; version: string | null; providers: string[] }));
      const created = await addOrg({
        name: health.name ?? info.org.name,
        server_url: serverUrl,
        server_kind: "manual",
        accent_color: info.org.accent_color ?? null,
        icon_url: info.org.icon_url ?? null,
        version: (health as { version?: string | null }).version ?? null,
        role: result.role,
      });
      await invoke("set_org_remote_id", { orgId: created.id, remoteId: result.org_id });
      await refreshOrgs();
      await setActiveOrg(created.id);
      pushToast({ level: "success", title: t("orgs.invitePage.joinedToast"), body: info.org.name });
      navigate("/dashboard");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-20 flex max-w-lg flex-col gap-4 rounded-xl border border-border-subtle bg-surface-overlay p-6 shadow-md">
      <h1 className="text-h1 text-text">{t("orgs.invitePage.title")}</h1>
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-danger/40 bg-danger-soft p-3 text-caption text-danger">
          <CloudOff className="h-4 w-4" strokeWidth={1.5} />
          {error}
        </div>
      )}
      {!info && !error && (
        <div className="flex items-center gap-2 text-body text-text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("orgs.invitePage.loading")}
        </div>
      )}
      {info && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 rounded-md border border-border-subtle bg-surface-elevated p-3">
            <span
              className="grid h-10 w-10 place-items-center rounded-md text-white"
              style={{ background: info.org.accent_color ?? "#0ea5e9" }}
            >
              {info.org.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <p className="text-h3 font-semibold text-text">{info.org.name}</p>
              <p className="text-caption text-text-muted">
                {t("orgs.invitePage.joinAs", { role: t(`orgs.roles.${info.role}`) })}
              </p>
              <p className="text-tiny text-text-faint">{serverUrl}</p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => navigate("/dashboard")}>
              {t("orgs.invitePage.cancel")}
            </Button>
            <Button variant="primary" size="sm" onClick={join} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" strokeWidth={1.5} />}
              {t("orgs.invitePage.join")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
