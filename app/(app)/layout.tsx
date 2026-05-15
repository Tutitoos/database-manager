"use client";

import { Boxes, Plug, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconButton } from "@/components/icon-button";
import { appBg, panel, sectionBorder, surface } from "@/lib/styles";
import { cn } from "@/lib/utils";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <main className={cn("flex h-screen text-zinc-100", appBg)}>
      <section className={cn("flex h-screen w-full overflow-hidden", surface)}>
        <aside className={cn("flex w-14 flex-col items-center border-r", panel, sectionBorder)}>
          <div className="mt-4 grid h-9 w-9 place-items-center rounded-md border border-zinc-700/70 bg-[#101010] text-zinc-100">
            <Boxes className="h-5 w-5" />
          </div>
          <nav className="mt-10 flex flex-1 flex-col gap-2">
            <Link href="/connections">
              <IconButton active={pathname.startsWith("/connections")} label="Conexiones">
                <Plug className="h-5 w-5" />
              </IconButton>
            </Link>
            <Link href="/settings">
              <IconButton active={pathname.startsWith("/settings")} label="Ajustes">
                <Settings className="h-5 w-5" />
              </IconButton>
            </Link>
          </nav>
        </aside>
        {children}
      </section>
    </main>
  );
}
