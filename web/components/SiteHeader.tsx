"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { LangToggle } from "./LangToggle";
import { Logo } from "./Logo";
import { LogoutButton } from "./LogoutButton";

export function SiteHeader({ email }: { email: string | null }) {
  const pathname = usePathname();
  const { t } = useI18n();
  // Matches the page container rule: job workspace pages run wider than the rest.
  const wide = /^\/jobs\/[^/]+$/.test(pathname);

  const nav = [
    { href: "/submit", label: t.nav.submit },
    { href: "/jobs", label: t.nav.jobs },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-bg/80 backdrop-blur-md">
      <div className={`mx-auto flex h-16 w-full ${wide ? "max-w-7xl" : "max-w-6xl"} items-center justify-between px-5 sm:px-6`}>
        <Link href="/" className="group flex items-center gap-2.5">
          <Logo className="h-8 w-8 transition-opacity group-hover:opacity-80" />
          <span className="text-lead font-semibold tracking-tight text-fg">BGCMaster</span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-btn px-3 py-1.5 transition-colors duration-150 ${
                  active ? "bg-elevated text-fg" : "text-fg-muted hover:bg-elevated/60 hover:text-fg"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <div className="ml-2">
            <LangToggle />
          </div>
          {email ? (
            <div className="ml-2 flex items-center gap-2 border-l border-white/[0.08] pl-3">
              <span className="hidden max-w-52 truncate font-mono text-xs text-fg-muted sm:inline">{email}</span>
              <LogoutButton />
            </div>
          ) : (
            <Link
              href="/login"
              className="ml-2 rounded-btn border border-white/[0.08] px-3.5 py-1.5 text-body font-medium text-fg transition-colors duration-150 hover:border-white/[0.16]"
            >
              {t.nav.login}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
