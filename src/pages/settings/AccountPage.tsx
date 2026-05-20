import {
  Download,
  Fingerprint,
  Loader2,
  LogIn,
  LogOut,
  Trash2,
  UserCircle2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { pushToast } from "@/components/ui/toast";
import { Modal } from "@/components/modal";
import { SettingsCard, SettingsRow } from "@/components/settings/SettingsCard";
import { currentUser, signOut } from "@/lib/auth";
import { saveJson } from "@/lib/save-file";
import type { AppUser } from "@/lib/types";
import { useOrgs } from "@/store/orgs";

export default function AccountPage() {
  const { t } = useTranslation();
  const [user, setUser] = useState<AppUser | null>(null);
  const [bioSupported, setBioSupported] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { orgs, activeId } = useOrgs();
  const activeOrg = orgs.find((o) => o.id === activeId) ?? null;
  const isLocalOrg = activeOrg?.server_kind === "local";

  async function refresh() {
    const [u, bs] = await Promise.all([
      currentUser(),
      invoke<boolean>("auth_biometry_supported").catch(() => false),
    ]);
    setUser(u);
    setBioSupported(bs);
  }

  useEffect(() => {
    refresh().catch((e) => pushToast({ level: "danger", title: String(e) }));
  }, []);

  const linked: string[] = (() => {
    try { return JSON.parse(user?.linked_providers ?? "[]") as string[]; }
    catch { return []; }
  })();

  async function handleSignOut() {
    await signOut();
    pushToast({ level: "info", title: t("account.toasts.signedOut") });
    await refresh();
  }

  async function handleForgetDevice() {
    try {
      await invoke("auth_forget_device");
      pushToast({ level: "info", title: t("account.security.forgotten") });
      await refresh();
    } catch (e) {
      pushToast({ level: "danger", title: String(e) });
    }
  }

  async function handleExport() {
    try {
      const [conns, groups, creds, orgs] = await Promise.all([
        invoke<unknown[]>("list_connections").catch(() => []),
        invoke<unknown[]>("list_groups").catch(() => []),
        invoke<unknown[]>("list_credentials_view").catch(() => []),
        invoke<unknown[]>("list_organizations").catch(() => []),
      ]);
      const dump = {
        schema: "database-manager.account-export",
        schema_version: 1,
        exported_at: new Date().toISOString(),
        user,
        connections: conns,
        groups,
        credentials: creds,
        organizations: orgs,
      };
      const res = await saveJson(dump, {
        defaultPath: `database-manager-data-${new Date().toISOString().slice(0, 10)}.json`,
        title: t("account.toasts.exportOk"),
      });
      if (!res.saved) return;
      pushToast({ level: "success", title: t("account.toasts.exportOk"), body: res.path ?? undefined });
    } catch (e) {
      pushToast({ level: "danger", title: String(e) });
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 pb-12">
      <header className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg border border-border-subtle bg-surface-elevated text-text">
          <UserCircle2 strokeWidth={1.5} className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-h1 text-text">{t("account.title")}</h1>
          <p className="text-caption text-text-muted">{t("account.subtitle")}</p>
        </div>
      </header>

      <SettingsCard title={t("account.profile.title")}>
        {isLocalOrg ? (
          <SettingsRow
            label={t("account.profile.localTitle")}
            description={t("account.profile.localBody")}
            control={
              <span className="text-tiny rounded-md bg-surface-elevated px-2 py-0.5 font-mono text-text-muted">
                __local__
              </span>
            }
          />
        ) : !user ? (
          <SettingsRow
            label={t("account.profile.notSignedIn")}
            control={
              <Link to="/login">
                <Button variant="primary" size="sm">
                  <LogIn className="h-3.5 w-3.5" /> {t("account.profile.signIn")}
                </Button>
              </Link>
            }
          />
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className="h-10 w-10 rounded-full" />
              ) : (
                <div className="grid h-10 w-10 place-items-center rounded-full bg-surface-hover text-text-muted">
                  <UserCircle2 className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-body truncate font-medium text-text">{user.name ?? user.email}</p>
                <p className="text-caption truncate text-text-muted">{user.email}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={handleSignOut}>
                <LogOut className="h-3.5 w-3.5" /> {t("account.profile.signOut")}
              </Button>
            </div>
            <SettingsRow
              label={t("account.profile.providers")}
              control={
                <div className="flex flex-wrap gap-1.5">
                  {linked.length === 0 && <span className="text-body text-text-faint">{t("account.profile.noProviders")}</span>}
                  {linked.map((p) => (
                    <span key={p} className="text-tiny rounded-full border border-border-strong bg-surface-elevated px-2 py-0.5 capitalize text-text">
                      {p}
                    </span>
                  ))}
                </div>
              }
            />
          </>
        )}
      </SettingsCard>

      {!isLocalOrg && (
      <SettingsCard title={t("account.security.title")}>
        <SettingsRow
          label={t("account.security.biometryGate")}
          description={
            bioSupported
              ? t("account.security.biometrySupported")
              : t("account.security.biometryUnsupported")
          }
          control={
            <div className="flex items-center gap-2">
              <span className="text-caption inline-flex items-center gap-1 rounded-md bg-surface-elevated px-2 py-0.5 text-text-muted">
                <Fingerprint className="h-3 w-3" />
                {bioSupported ? "OK" : "—"}
              </span>
              {bioSupported && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    try {
                      const ok = await invoke<boolean>("auth_load_bearer_biometric");
                      pushToast({
                        level: ok ? "success" : "info",
                        title: ok
                          ? t("account.security.biometryRestoreOk")
                          : t("account.security.biometryRestoreNone"),
                      });
                      await refresh();
                    } catch (e) {
                      pushToast({ level: "danger", title: String(e) });
                    }
                  }}
                >
                  <Fingerprint className="h-3.5 w-3.5" /> {t("account.security.biometryRestoreButton")}
                </Button>
              )}
            </div>
          }
        />
        <SettingsRow
          label={t("account.security.forgetLabel")}
          description={t("account.security.forgetDescription")}
          control={
            <Button variant="danger" size="sm" onClick={handleForgetDevice}>
              <Trash2 className="h-3.5 w-3.5" /> {t("account.security.forgetButton")}
            </Button>
          }
        />
      </SettingsCard>
      )}

      {user && (
        <SettingsCard title={t("account.sessions.title")}>
          <SettingsRow
            label={t("account.sessions.thisDevice")}
            description={`${t("account.sessions.lastSync")}: ${user.last_synced_at ?? t("account.sessions.never")}`}
            control={
              <span className="text-caption inline-flex items-center gap-1 rounded-md bg-success-soft px-2 py-0.5 text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> {t("account.sessions.active")}
              </span>
            }
          />
        </SettingsCard>
      )}

      <SettingsCard title={t("account.danger.title")}>
        <SettingsRow
          label={t("account.danger.exportLabel")}
          description={t("account.danger.exportDescription")}
          control={
            <Button variant="secondary" size="sm" onClick={handleExport}>
              <Download className="h-3.5 w-3.5" /> {t("account.danger.exportButton")}
            </Button>
          }
        />
        {!isLocalOrg && (
          <SettingsRow
            label={t("account.danger.deleteLabel")}
            description={t("account.danger.deleteDescription")}
            control={
              <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-3.5 w-3.5" /> {t("account.danger.deleteButton")}
              </Button>
            }
          />
        )}
      </SettingsCard>

      {deleteOpen && (
        <Modal onClose={() => setDeleteOpen(false)}>
          <div className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-overlay p-5">
            <h2 className="text-h2 text-text">{t("account.danger.deleteLabel")}</h2>
            <p className="text-body mt-2 text-text-muted">{t("account.danger.deleteSoon")}</p>
            <div className="mt-4 flex justify-end">
              <Button variant="secondary" size="sm" onClick={() => setDeleteOpen(false)}>OK</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Helper to silence unused import in some configurations.
void Loader2;
