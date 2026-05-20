import { Check, ChevronDown, Cloud, Plus, Server, Settings } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { AddOrgWizard } from "@/components/shell/AddOrgWizard";
import { pushToast } from "@/components/ui/toast";
import {
  isOrgSelectable,
  OrgOfflineError,
  setActiveOrg,
  useOrgs,
  type OrgRecord,
} from "@/store/orgs";
import { cn } from "@/lib/utils";

export function OrgSwitcher() {
  const { t } = useTranslation();
  const orgsState = useOrgs();
  const { orgs, activeId } = orgsState;
  const [wizardOpen, setWizardOpen] = useState(false);
  const active = orgs.find((o) => o.id === activeId) ?? orgs[0];

  return (
    <>
      <div className="relative z-30 border-b border-border-subtle px-2 py-2">
        <Dropdown
          align="start"
          trigger={
            <span
              className={cn(
                "flex w-full items-center gap-2 rounded-md border border-border-subtle bg-surface-elevated px-2 py-1.5 text-body transition-colors hover:bg-surface-hover",
              )}
            >
              <OrgChip org={active} />
              <ChevronDown strokeWidth={1.5} className="ml-auto h-3 w-3 text-text-faint" />
            </span>
          }
          className="w-[15rem]"
        >
          {(close) => (
            <div className="max-h-[60vh] overflow-y-auto">
              <div className="py-1">
                {orgs.map((org) => {
                  const selectable = isOrgSelectable(org, orgsState);
                  return (
                    <button
                      key={org.id}
                      type="button"
                      disabled={!selectable}
                      title={selectable ? undefined : t("orgs.offlineDisabled")}
                      onClick={async () => {
                        if (!selectable) {
                          pushToast({
                            level: "danger",
                            title: t("orgs.offlineDisabled"),
                            body: org.name,
                          });
                          return;
                        }
                        try {
                          await setActiveOrg(org.id);
                        } catch (e) {
                          if (e instanceof OrgOfflineError) {
                            pushToast({
                              level: "danger",
                              title: t("orgs.offlineDisabled"),
                              body: org.name,
                            });
                          } else {
                            pushToast({ level: "danger", title: String(e) });
                          }
                        }
                        close();
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-body transition-colors",
                        selectable
                          ? "text-text hover:bg-surface-hover"
                          : "cursor-not-allowed text-text-muted opacity-60",
                      )}
                    >
                      <OrgAvatar org={org} dim={!selectable} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{org.name}</p>
                        {org.server_kind !== "local" && (
                          <p className="truncate text-[10px] text-text-faint">
                            {org.server_url ?? "—"}
                          </p>
                        )}
                      </div>
                      {!selectable && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger"
                          aria-label={t("orgs.status.offline")}
                        />
                      )}
                      {selectable && org.id === activeId && (
                        <Check strokeWidth={2} className="h-3 w-3 text-accent" />
                      )}
                    </button>
                  );
                })}
              </div>
              <DropdownSeparator />
              <DropdownItem
                icon={<Plus strokeWidth={1.5} className="h-3.5 w-3.5" />}
                onClick={() => {
                  setWizardOpen(true);
                  close();
                }}
              >
                Añadir organización
              </DropdownItem>
              <Link to="/settings/organizations" onClick={close}>
                <DropdownItem icon={<Settings strokeWidth={1.5} className="h-3.5 w-3.5" />}>
                  Gestionar organizaciones
                </DropdownItem>
              </Link>
            </div>
          )}
        </Dropdown>
      </div>
      {wizardOpen && <AddOrgWizard onClose={() => setWizardOpen(false)} />}
    </>
  );
}

function OrgChip({ org }: { org?: OrgRecord }) {
  if (!org) return <span className="text-text-faint">Sin organización</span>;
  return (
    <>
      <OrgAvatar org={org} />
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-text">{org.name}</p>
        {org.server_kind !== "local" && (
          <p className="truncate text-[10px] text-text-faint">
            {org.server_url ?? "—"}
          </p>
        )}
      </div>
    </>
  );
}

function OrgAvatar({ org, dim = false }: { org: OrgRecord; dim?: boolean }) {
  const color = org.accent_color ?? (org.server_kind === "local" ? "#71717a" : "#0ea5e9");
  const Icon = org.server_kind === "local" ? Server : Cloud;
  return (
    <span
      className={cn(
        "grid h-6 w-6 shrink-0 place-items-center rounded-md border border-border-subtle text-white",
        dim && "grayscale opacity-70",
      )}
      style={{ background: color }}
    >
      <Icon strokeWidth={1.5} className="h-3.5 w-3.5" />
    </span>
  );
}
