"use client";

import { usePathname } from "next/navigation";

// Matches the page container rule: job workspace pages run wider than the rest.
export function SiteFooter({ methods }: { methods: string }) {
  const pathname = usePathname();
  const wide = /^\/jobs\/[^/]+$/.test(pathname);

  return (
    <footer className={`mx-auto w-full ${wide ? "max-w-7xl" : "max-w-6xl"} px-5 pb-8 pt-4 sm:px-6`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-5 text-caption text-fg-subtle">
        <span>{methods}</span>
        <span>bgcmaster.bio</span>
      </div>
    </footer>
  );
}
