import {
  Check,
  Cloud,
  Edit3,
  LogOut,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  UserCircle2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Link } from "@tanstack/react-router";
import { AddOrgWizard } from "@/components/shell/AddOrgWizard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/modal";
import { pushToast } from "@/components/ui/toast";
import { SettingsCard } from "@/components/settings/SettingsCard";
import {
  deleteOrg,
  fetchOrgHealth,
  isOrgSelectable,
  markOrgHealth,
  OrgOfflineError,
  refreshOrgs,
  setActiveOrg,
  updateOrg,
  useOrgs,
  type OrgRecord,
} from "@/store/orgs";
import { signOut as authSignOut } from "@/lib/auth";
import { cn } from "@/lib/utils";

type HealthState = "idle" | "checking" | "online" | "offline";

export default function OrganizationsPage() {
  const { t } = useTranslation();
  const orgsState = useOrgs();
  const { orgs, activeId, health: storeHealth } = orgsState;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [deleting, setDeleting] = useState<OrgRecord | null>(null);
  const [editing, setEditing] = useState<OrgRecord | null>(null);
  const [localHealth, setLocalHealth] = useState<Record<number, HealthState>>({});
  const health: Record<number, HealthState> = { ...storeHealth, ...localHealth };
  const [memberCounts, setMemberCounts] = useState<Record<number, number>>({});

  useEffect(() => {
    void refreshOrgs();
  }, []);

  useEffect(() => {
    if (selectedId == null && orgs.length > 0) setSelectedId(activeId ?? orgs[0].id);
  }, [orgs, activeId, selectedId]);

  const selected = useMemo(() => orgs.find((o) => o.id === selectedId) ?? null, [orgs, selectedId]);

  // Members count for selected (if remote + role >= member).
  useEffect(() => {
    if (!selected || selected.server_kind === "local" || !selected.role) return;
    if (memberCounts[selected.id] != null) return;
    void invoke<{ user_id: string }[]>("org_list_members", { orgId: selected.id })
      .then((list) => setMemberCounts((m) => ({ ...m, [selected.id]: list.length })))
      .catch(() => undefined);
  }, [selected, memberCounts]);

  async function recheck(org: OrgRecord) {
    if (!org.server_url) return;
    setLocalHealth((h) => ({ ...h, [org.id]: "checking" }));
    markOrgHealth(org.id, "checking");
    try {
      const h = await fetchOrgHealth(org.server_url);
      setLocalHealth((s) => ({ ...s, [org.id]: "online" }));
      markOrgHealth(org.id, "online");
      const patch: Parameters<typeof updateOrg>[1] = {};
      if (h.version) patch.version = h.version;
      if (h.accent_color) patch.accent_color = h.accent_color;
      if (h.icon_url) patch.icon_url = h.icon_url;
      if (Object.keys(patch).length > 0) await updateOrg(org.id, patch);
      pushToast({ level: "success", title: t("orgs.toasts.recheckOk"), body: org.name });
    } catch {
      setLocalHealth((s) => ({ ...s, [org.id]: "offline" }));
      markOrgHealth(org.id, "offline");
      pushToast({ level: "danger", title: t("orgs.toasts.recheckFail"), body: org.name });
    }
  }

  // Auto-fetch metadata on first selection of a remote org if version is empty.
  useEffect(() => {
    if (!selected) return;
    if (selected.server_kind === "local") return;
    if (selected.version) return;
    if (health[selected.id]) return;
    void recheck(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  async function performDelete(org: OrgRecord) {
    try {
      await deleteOrg(org.id);
      pushToast({ level: "info", title: t("orgs.toasts.deleted"), body: org.name });
      if (selectedId === org.id) setSelectedId(null);
      setDeleting(null);
    } catch (e) {
      pushToast({ level: "danger", title: t("orgs.toasts.deleteFailed"), body: String(e) });
    }
  }

  async function performSwitch(org: OrgRecord) {
    if (!isOrgSelectable(org, orgsState)) {
      pushToast({ level: "danger", title: t("orgs.offlineDisabled"), body: org.name });
      return;
    }
    try {
      await setActiveOrg(org.id);
      pushToast({ level: "success", title: t("orgs.toasts.switchOk", { name: org.name }) });
    } catch (e) {
      if (e instanceof OrgOfflineError) {
        pushToast({ level: "danger", title: t("orgs.offlineDisabled"), body: org.name });
      } else {
        pushToast({ level: "danger", title: String(e) });
      }
    }
  }

  async function performSignOut() {
    await authSignOut().catch(() => undefined);
    pushToast({ level: "info", title: t("orgs.signOut") });
    await refreshOrgs();
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-12">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg border border-border-subtle bg-surface-elevated text-text">
            <Cloud strokeWidth={1.5} className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-h1 text-text">{t("orgs.title")}</h1>
            <p className="text-caption text-text-muted">{t("orgs.subtitle")}</p>
          </div>
        </div>
        <Button variant="primary" size="sm" onClick={() => setWizardOpen(true)}>
          <Plus strokeWidth={1.5} className="h-3.5 w-3.5" />
          {t("orgs.add")}
        </Button>
      </header>

      <div className="grid grid-cols-12 gap-4">
        {/* Master list */}
        <div className="col-span-4">
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-elevated">
            {orgs.length === 0 && (
              <p className="text-body p-4 text-text-muted">{t("orgs.empty")}</p>
            )}
            {orgs.map((org) => {
              const selectable = isOrgSelectable(org, orgsState);
              return (
                <button
                  key={org.id}
                  type="button"
                  onClick={() => setSelectedId(org.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 border-b border-border-subtle px-3 py-2.5 text-left transition-colors last:border-b-0",
                    selectedId === org.id ? "bg-accent-soft" : "hover:bg-surface-hover",
                    !selectable && "opacity-60",
                  )}
                  title={selectable ? undefined : t("orgs.offlineDisabled")}
                >
                  <OrgAvatar org={org} size={28} dim={!selectable} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-body truncate font-medium", selectable ? "text-text" : "text-text-muted")}>
                      {org.name}
                    </p>
                    <p className="text-caption truncate text-text-muted">
                      {org.server_kind === "local" ? t("orgs.kind.local") : org.server_url ?? ""}
                    </p>
                  </div>
                  {!selectable && (
                    <span className="text-tiny inline-flex items-center gap-1 rounded-sm bg-surface px-1.5 py-0.5 font-semibold uppercase tracking-wider text-text-faint">
                      <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                      {t("orgs.status.offline")}
                    </span>
                  )}
                  {selectable && org.id === activeId && (
                    <span className="text-tiny rounded-sm bg-accent-soft px-1.5 py-0.5 font-semibold uppercase tracking-wider text-accent">
                      {t("orgs.active")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Detail */}
        <div className="col-span-8">
          {!selected && (
            <div className="grid h-48 place-items-center rounded-lg border border-dashed border-border-subtle text-caption text-text-muted">
              {t("orgs.select")}
            </div>
          )}
          {selected && (
            <DetailPanel
              org={selected}
              isActive={selected.id === activeId}
              healthState={health[selected.id]}
              selectable={isOrgSelectable(selected, orgsState)}
              membersCount={memberCounts[selected.id]}
              onSwitch={() => performSwitch(selected)}
              onRecheck={() => recheck(selected)}
              onEdit={() => setEditing(selected)}
              onDelete={() => setDeleting(selected)}
              onSignOut={performSignOut}
            />
          )}
        </div>
      </div>

      {wizardOpen && <AddOrgWizard onClose={() => setWizardOpen(false)} />}

      {deleting && (
        <Modal onClose={() => setDeleting(null)}>
          <div className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-overlay p-5 shadow-md">
            <h2 className="text-h2 text-text">{t("orgs.deleteConfirm.title")}</h2>
            <p className="text-body mt-2 text-text-muted">
              {t("orgs.deleteConfirm.body", { name: deleting.name })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDeleting(null)}>
                {t("orgs.deleteConfirm.cancel")}
              </Button>
              <Button variant="danger" size="sm" onClick={() => performDelete(deleting)}>
                {t("orgs.deleteConfirm.confirm")}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {editing && <EditOrgModal org={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function OrgAvatar({ org, size = 28, dim = false }: { org: OrgRecord; size?: number; dim?: boolean }) {
  const bg = org.accent_color ?? (org.server_kind === "local" ? "#71717a" : "#0ea5e9");
  return (
    <span
      className={cn("grid shrink-0 place-items-center rounded-md text-white", dim && "grayscale opacity-70")}
      style={{ background: bg, height: size, width: size }}
    >
      {org.server_kind === "local" ? (
        <Server strokeWidth={1.5} className="h-3.5 w-3.5" />
      ) : (
        <Cloud strokeWidth={1.5} className="h-3.5 w-3.5" />
      )}
    </span>
  );
}

function DetailPanel({
  org,
  isActive,
  healthState,
  selectable,
  membersCount,
  onSwitch,
  onRecheck,
  onEdit,
  onDelete,
  onSignOut,
}: {
  org: OrgRecord;
  isActive: boolean;
  healthState?: HealthState;
  selectable: boolean;
  membersCount?: number;
  onSwitch: () => void;
  onRecheck: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const liveState: HealthState = healthState ?? (org.last_health_ok ? "online" : org.server_kind === "local" ? "online" : "idle");
  return (
    <div className="flex flex-col gap-4">
      {/* Hero */}
      <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-elevated p-4">
        <OrgAvatar org={org} size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-h1 truncate text-text">{org.name}</h2>
            {isActive && (
              <span className="text-tiny rounded-sm bg-accent-soft px-1.5 py-0.5 font-semibold uppercase tracking-wider text-accent">
                {t("orgs.active")}
              </span>
            )}
          </div>
          <p className="text-caption text-text-muted">
            {org.server_kind === "local" ? t("orgs.kind.local") : org.server_url}
            {org.version && <span className="ml-1 text-text-faint">· v{org.version}</span>}
          </p>
        </div>
        {org.server_kind !== "local" && <HealthBadge state={liveState} />}
      </div>

      {/* Properties */}
      <SettingsCard title="">
        {org.server_kind !== "local" && (
          <PropertyRow label={t("orgs.fields.server")} value={<span className="font-mono">{org.server_url ?? "—"}</span>} />
        )}
        <PropertyRow label={t("orgs.fields.version")} value={org.version ? `v${org.version}` : "—"} />
        {org.cert_fingerprint && (
          <PropertyRow
            label={t("orgs.fields.fingerprint")}
            value={<code className="text-body-mono text-text-muted">{org.cert_fingerprint.slice(0, 20)}…</code>}
          />
        )}
        {org.user_email && (
          <PropertyRow
            label={t("orgs.fields.user")}
            value={
              <span className="flex items-center gap-2">
                <UserCircle2 className="h-3.5 w-3.5 text-text-faint" strokeWidth={1.5} />
                {org.user_email}
              </span>
            }
          />
        )}
        <PropertyRow label={t("orgs.fields.role")} value={org.role ? t(`orgs.roles.${org.role}`) : t("orgs.roles.none")} />
        {membersCount != null && (
          <PropertyRow
            label={t("orgs.membersLabel")}
            value={
              membersCount === 0
                ? t("orgs.fields.membersNone")
                : membersCount === 1
                  ? t("orgs.fields.membersOne")
                  : t("orgs.fields.membersCount", { count: membersCount })
            }
          />
        )}
      </SettingsCard>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        {!isActive && (
          <Button
            variant="primary"
            size="sm"
            onClick={onSwitch}
            disabled={!selectable}
            title={selectable ? undefined : t("orgs.offlineDisabled")}
          >
            <Check className="h-3.5 w-3.5" /> {t("orgs.switchTo")}
          </Button>
        )}
        {isActive && (
          <span className="text-caption inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent-soft px-2 py-1 text-accent">
            <ShieldCheck className="h-3.5 w-3.5" /> {t("orgs.currentlyActive")}
          </span>
        )}
        {org.server_kind !== "local" && org.role && ["owner", "admin", "member", "viewer"].includes(org.role) && (
          <Link to="/settings/organizations/$orgId/members" params={{ orgId: String(org.id) }}>
            <Button variant="secondary" size="sm">
              <Users className="h-3.5 w-3.5" /> {t("orgs.membersLabel")}
            </Button>
          </Link>
        )}
        <Button variant="secondary" size="sm" onClick={onEdit}>
          <Edit3 className="h-3.5 w-3.5" /> {t("orgs.edit")}
        </Button>
        {org.server_kind !== "local" && (
          <Button variant="secondary" size="sm" onClick={onRecheck}>
            <RefreshCw className="h-3.5 w-3.5" /> {t("orgs.recheck")}
          </Button>
        )}
        {org.server_kind !== "local" && org.user_email && (
          <Button variant="ghost" size="sm" onClick={onSignOut}>
            <LogOut className="h-3.5 w-3.5" /> {t("orgs.signOut")}
          </Button>
        )}
        {org.server_kind !== "local" && (
          <Button variant="ghost" size="sm" onClick={onDelete} className="ml-auto text-danger">
            <Trash2 className="h-3.5 w-3.5" /> {t("orgs.delete")}
          </Button>
        )}
      </div>
    </div>
  );
}

function PropertyRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border-subtle px-4 py-2.5 last:border-b-0">
      <span className="text-caption text-text-muted">{label}</span>
      <span className="text-body text-text">{value}</span>
    </div>
  );
}

function HealthBadge({ state }: { state: HealthState }) {
  const { t } = useTranslation();
  if (state === "checking") {
    return (
      <span className="text-caption inline-flex items-center gap-1 rounded-md bg-surface px-2 py-0.5 text-text-muted">
        <RefreshCw className="h-3 w-3 animate-spin" /> {t("orgs.status.checking")}
      </span>
    );
  }
  if (state === "online") {
    return (
      <span className="text-caption inline-flex items-center gap-1 rounded-md bg-success-soft px-2 py-0.5 text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success" /> {t("orgs.status.online")}
      </span>
    );
  }
  if (state === "offline") {
    return (
      <span className="text-caption inline-flex items-center gap-1 rounded-md bg-danger-soft px-2 py-0.5 text-danger">
        <span className="h-1.5 w-1.5 rounded-full bg-danger" /> {t("orgs.status.offline")}
      </span>
    );
  }
  return null;
}

function EditOrgModal({ org, onClose }: { org: OrgRecord; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(org.name);
  const [accent, setAccent] = useState(org.accent_color ?? "#0ea5e9");
  const [iconUrl, setIconUrl] = useState(org.icon_url ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await updateOrg(org.id, { name, accent_color: accent, icon_url: iconUrl || null });
      pushToast({ level: "success", title: t("orgs.toasts.saved"), body: name });
      onClose();
    } catch (e) {
      pushToast({ level: "danger", title: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-overlay p-5">
        <h2 className="text-h2 text-text">{t("orgs.editModal.title")}</h2>
        <div className="mt-4 flex flex-col gap-3">
          <Input
            placeholder={t("orgs.editModal.namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="flex items-center gap-2 text-body text-text-muted">
            <span className="w-32">{t("orgs.editModal.accentLabel")}</span>
            <input
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              className="h-7 w-12 cursor-pointer rounded border border-border-subtle bg-surface"
            />
            <input
              type="text"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              className="text-body-mono h-7 flex-1 rounded-md border border-border-subtle bg-surface px-2 text-text"
            />
          </label>
          <label className="flex items-center gap-2 text-body text-text-muted">
            <span className="w-32">{t("orgs.editModal.iconLabel")}</span>
            <Input value={iconUrl} onChange={(e) => setIconUrl(e.target.value)} placeholder="https://…" />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            {t("orgs.editModal.cancel")}
          </Button>
          <Button variant="primary" size="sm" onClick={save} disabled={busy}>
            {t("orgs.editModal.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
