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

  const nav = [
    { href: "/submit", label: t.nav.submit },
    { href: "/jobs", label: t.nav.jobs },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-[92rem] items-center justify-between px-5">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-soft ring-1 ring-inset ring-brand/30 transition group-hover:ring-brand/60">
            <Logo className="h-5 w-5 text-brand" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">
            <span className="text-brand">BGC</span>Master
          </span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-btn px-3 py-1.5 transition ${
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
            <Link href="/login" className="btn-primary ml-2 rounded-btn px-3.5 py-1.5 text-sm font-medium">
              {t.nav.login}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
