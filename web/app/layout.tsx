import "./globals.css";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { getOptionalUser } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/LogoutButton";
import { Logo } from "@/components/Logo";

export const metadata: Metadata = {
  title: "BGCMaster",
  description: "面向细菌基因组的 BGC 区域检测、类型分类、安全分级和注释工作流。",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getOptionalUser();

  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-bg font-sans text-fg antialiased">
        <header className="border-b border-border bg-bg/90">
          <div className="mx-auto flex h-14 max-w-content items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <Logo className="h-6 w-6 text-brand" />
              <span>BGCMaster</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <NavLink href="/submit">提交任务</NavLink>
              <NavLink href="/jobs">任务记录</NavLink>
              {user ? (
                <div className="ml-2 flex items-center gap-2 border-l border-border pl-3">
                  <span className="hidden max-w-52 truncate text-xs text-fg-muted sm:inline">{user.email}</span>
                  <LogoutButton />
                </div>
              ) : (
                <Link
                  href="/login"
                  className="ml-2 rounded-btn bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg"
                >
                  登录
                </Link>
              )}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-content px-4 py-8">{children}</main>
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded-btn px-3 py-1.5 text-fg-muted hover:bg-elevated hover:text-fg">
      {children}
    </Link>
  );
}
