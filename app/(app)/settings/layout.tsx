"use client";

import { Plug, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SideItem } from "@/components/side-item";
import { panel, sectionBorder } from "@/lib/styles";
import { cn } from "@/lib/utils";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className={cn("flex min-w-0 flex-1", panel)}>
      <aside className={cn("w-48 shrink-0 border-r p-3", panel, sectionBorder)}>
        <Link href="/settings/general">
          <SideItem
            active={pathname === "/settings" || pathname === "/settings/general"}
            icon={<Settings className="h-4 w-4" />}
            label="General"
          />
        </Link>
        <Link href="/settings/plugins">
          <SideItem
            active={pathname.startsWith("/settings/plugins")}
            icon={<Plug className="h-4 w-4" />}
            label="Plugins"
          />
        </Link>
      </aside>
      <section className={cn("min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-6", panel)}>
        {children}
      </section>
    </div>
  );
}
