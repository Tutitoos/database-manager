import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "@/lib/router-compat";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Copy, Plus, ShieldCheck, Trash2, UserCircle2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/modal";
import { pushToast } from "@/components/ui/toast";
import { isOrgSelectable, useOrgs } from "@/store/orgs";

interface Member {
  user_id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: "owner" | "admin" | "member" | "viewer";
  joined_at: string;
}

const ROLES: Member["role"][] = ["owner", "admin", "member", "viewer"];

export default function MembersPage() {
  const { t } = useTranslation();
  const params = useParams() as { orgId?: string };
  const orgId = Number(params.orgId);
  const orgsState = useOrgs();
  const { orgs } = orgsState;
  const org = orgs.find((o) => o.id === orgId);
  const offline = org ? !isOrgSelectable(org, orgsState) : false;
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  async function load() {
    if (!org || org.server_kind === "local") return;
    if (offline) return;
    setLoading(true);
    setError(null);
    try {
      const list = await invoke<Member[]>("org_list_members", { orgId });
      setMembers(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  async function changeRole(m: Member, role: Member["role"]) {
    try {
      await invoke("org_set_member_role", { orgId, userId: m.user_id, role });
      pushToast({ level: "success", title: t("orgs.members.roleChanged"), body: `${m.email} → ${role}` });
      await load();
    } catch (e) {
      pushToast({ level: "danger", title: t("orgs.members.errorPrefix"), body: String(e) });
    }
  }

  async function kick(m: Member) {
    if (!confirm(t("orgs.members.kick", { email: m.email }))) return;
    try {
      await invoke("org_remove_member", { orgId, userId: m.user_id });
      pushToast({ level: "info", title: t("orgs.members.kickToast"), body: m.email });
      await load();
    } catch (e) {
      pushToast({ level: "danger", title: t("orgs.members.errorPrefix"), body: String(e) });
    }
  }

  if (!org) {
    return <p className="text-h3 text-text-muted">Organización no encontrada.</p>;
  }

  if (offline) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-12">
        <header className="flex items-center gap-3">
          <Link to="/settings/organizations">
            <Button variant="ghost" size="sm" aria-label={t("orgs.members.back")}>
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-h1 text-text">{t("orgs.members.title", { name: org.name })}</h1>
            <p className="text-body text-text-muted">{org.server_url}</p>
          </div>
        </header>
        <div className="grid h-48 place-items-center rounded-lg border border-dashed border-border-subtle text-caption text-text-muted">
          {t("orgs.offlineDisabled")}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-12">
      <header className="flex items-center gap-3">
        <Link to="/settings/organizations">
          <Button variant="ghost" size="sm" aria-label={t("orgs.members.back")}><ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} /></Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-h1 text-text">{t("orgs.members.title", { name: org.name })}</h1>
          <p className="text-body text-text-muted">{org.server_url}</p>
        </div>
        {org.role && ["owner", "admin"].includes(org.role) && (
          <Button variant="primary" size="sm" onClick={() => setInviteOpen(true)}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("orgs.members.invite")}
          </Button>
        )}
      </header>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger-soft p-3 text-[11px] text-danger">{error}</div>
      )}

      <section className="overflow-hidden rounded-lg border border-border-subtle bg-surface-elevated">
        <table className="w-full text-h3">
          <thead className="bg-surface-sunken text-[10px] uppercase tracking-wider text-text-faint">
            <tr>
              <th className="px-4 py-2 text-left">Miembro</th>
              <th className="px-4 py-2 text-left">Rol</th>
              <th className="px-4 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={3} className="px-4 py-6 text-center text-body text-text-muted">{t("orgs.members.loading")}</td></tr>
            )}
            {!loading && members.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-6 text-center text-body text-text-muted">{t("orgs.members.empty")}</td></tr>
            )}
            {members.map((m) => (
              <tr key={m.user_id} className="border-t border-border-subtle">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    {m.avatar_url ? (
                      <img src={m.avatar_url} alt="" className="h-6 w-6 rounded-full" />
                    ) : (
                      <UserCircle2 className="h-6 w-6 text-text-faint" strokeWidth={1.5} />
                    )}
                    <span className="flex flex-col">
                      <span className="font-medium text-text">{m.name ?? m.email}</span>
                      {m.name && <span className="text-[10px] text-text-faint">{m.email}</span>}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-body text-text-muted">
                  {org.role === "owner" || (org.role === "admin" && m.role !== "owner") ? (
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m, e.target.value as Member["role"])}
                      className="rounded-sm border border-border-subtle bg-surface px-1.5 py-0.5 text-[11px]"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r} disabled={r === "owner" && org.role !== "owner"}>{t(`orgs.roles.${r}`)}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" strokeWidth={1.5} /> {t(`orgs.roles.${m.role}`)}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {org.role && ["owner", "admin"].includes(org.role) && m.role !== "owner" && (
                    <Button variant="ghost" size="sm" onClick={() => kick(m)}>
                      <Trash2 className="h-3.5 w-3.5 text-danger" strokeWidth={1.5} />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {inviteOpen && <InviteModal orgId={orgId} serverUrl={org.server_url ?? ""} onClose={() => setInviteOpen(false)} />}
    </div>
  );
}

function InviteModal({ orgId, serverUrl, onClose }: { orgId: number; serverUrl: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [role, setRole] = useState<"admin" | "member" | "viewer">("member");
  const [ttl, setTtl] = useState(72);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const tok = await invoke<string>("org_create_invite", { orgId, role, ttlHours: ttl });
      setToken(tok);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const link = token ? `database-manager://invite?server=${encodeURIComponent(serverUrl)}&token=${token}` : "";

  return (
    <Modal onClose={onClose}>
      <div className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-overlay p-5">
        <h2 className="text-h3 font-semibold text-text">{t("orgs.members.inviteGenerate")}</h2>
        {!token ? (
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-body text-text-muted">
              {t("orgs.members.role")}
              <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} className="rounded-sm border border-border-subtle bg-surface p-1.5">
                <option value="viewer">{t("orgs.roles.viewer")}</option>
                <option value="member">{t("orgs.roles.member")}</option>
                <option value="admin">{t("orgs.roles.admin")}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-body text-text-muted">
              {t("orgs.members.ttl")}
              <input type="number" value={ttl} onChange={(e) => setTtl(Number(e.target.value) || 72)} min={1} className="rounded-sm border border-border-subtle bg-surface p-1.5" />
            </label>
            {error && <div className="text-[11px] text-danger">{error}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={onClose}>{t("orgs.members.cancel")}</Button>
              <Button variant="primary" size="sm" onClick={generate} disabled={busy}>{t("orgs.members.generate")}</Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-body text-text-muted">{t("orgs.members.inviteShare", { ttl })}</p>
            <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface p-2 font-mono text-[11px] text-text">
              <span className="truncate flex-1">{link}</span>
              <Button variant="ghost" size="sm" aria-label={t("orgs.members.inviteCopied")} onClick={() => { navigator.clipboard.writeText(link); pushToast({ level: "info", title: t("orgs.members.inviteCopied") }); }}>
                <Copy className="h-3 w-3" strokeWidth={1.5} />
              </Button>
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" onClick={onClose}>{t("orgs.members.close")}</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
