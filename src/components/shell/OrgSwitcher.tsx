import { Check, ChevronDown, Cloud, Plus, Server, Settings } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { AddOrgWizard } from "@/components/shell/AddOrgWizard";
import { setActiveOrg, useOrgs, type OrgRecord } from "@/store/orgs";
import { cn } from "@/lib/utils";

export function OrgSwitcher() {
  const { orgs, activeId } = useOrgs();
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
                {orgs.map((org) => (
                  <button
                    key={org.id}
                    type="button"
                    onClick={async () => {
                      await setActiveOrg(org.id);
                      close();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body text-text transition-colors hover:bg-surface-hover"
                  >
                    <OrgAvatar org={org} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-text">{org.name}</p>
                      {org.server_kind !== "local" && (
                        <p className="truncate text-[10px] text-text-faint">
                          {org.server_url ?? "—"}
                        </p>
                      )}
                    </div>
                    {org.id === activeId && (
                      <Check strokeWidth={2} className="h-3 w-3 text-accent" />
                    )}
                  </button>
                ))}
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

function OrgAvatar({ org }: { org: OrgRecord }) {
  const color = org.accent_color ?? (org.server_kind === "local" ? "#71717a" : "#0ea5e9");
  const Icon = org.server_kind === "local" ? Server : Cloud;
  return (
    <span
      className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-border-subtle text-white"
      style={{ background: color }}
    >
      <Icon strokeWidth={1.5} className="h-3.5 w-3.5" />
    </span>
  );
}
