import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/LogoutButton";
import { Logo } from "@/components/Logo";

export const metadata: Metadata = {
  title: "NP-Master — 下一代 BGC 发现平台",
  description: "上传细菌基因组 FASTA，得到 BGC 候选区域、产物类型、可视化结果。基于基因组语言模型 Evo2 的端到端分析平台。",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-white text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur dark:border-slate-800/70 dark:bg-slate-950/80">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <Logo className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
              <span>NP-Master</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <NavLink href="/submit">提交分析</NavLink>
              <NavLink href="/jobs">我的任务</NavLink>
              <NavLink href="/docs">文档</NavLink>
              <NavLink href="/about">关于</NavLink>
              <a
                href="https://github.com/Sophia-YH/NP-Master-web"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md px-3 py-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              >
                GitHub
              </a>
              {user ? (
                <div className="ml-2 flex items-center gap-2 border-l border-slate-200 pl-3 dark:border-slate-800">
                  <span className="hidden text-xs text-slate-500 sm:inline">{user.email}</span>
                  <LogoutButton />
                </div>
              ) : (
                <Link
                  href="/login"
                  className="ml-2 rounded-md bg-indigo-600 px-3 py-1.5 text-white shadow-sm transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
                >
                  登录
                </Link>
              )}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-10">{children}</main>
        <Footer />
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
    >
      {children}
    </Link>
  );
}

function Footer() {
  return (
    <footer className="mt-24 border-t border-slate-200 dark:border-slate-800">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <Logo className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <span className="text-sm font-semibold">NP-Master</span>
          </div>
          <p className="mt-3 text-xs text-slate-500">基因组语言模型驱动的 BGC 发现与注释平台。</p>
        </div>
        <FooterCol title="产品">
          <FooterLink href="/submit">提交分析</FooterLink>
          <FooterLink href="/jobs">我的任务</FooterLink>
          <FooterLink href="/docs">文档</FooterLink>
          <FooterLink href="/docs/api">REST API</FooterLink>
        </FooterCol>
        <FooterCol title="资源">
          <FooterLink href="/about#cite">引用</FooterLink>
          <FooterLink href="https://github.com/Sophia-YH/NP-Master-web" external>GitHub</FooterLink>
          <FooterLink href="/docs/api">API 文档</FooterLink>
          <FooterLink href="/about#changelog">更新日志</FooterLink>
        </FooterCol>
        <FooterCol title="关于">
          <FooterLink href="/about">方法 & 评测</FooterLink>
          <FooterLink href="/about#contact">联系</FooterLink>
          <FooterLink href="/about#license">License</FooterLink>
          <FooterLink href="/about#privacy">隐私</FooterLink>
        </FooterCol>
      </div>
      <div className="border-t border-slate-200 dark:border-slate-800">
        <div className="mx-auto max-w-6xl px-4 py-4 text-center text-xs text-slate-500">
          NP-Master · 学术研究用途 · © {new Date().getFullYear()}
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children, external }: { href: string; children: React.ReactNode; external?: boolean }) {
  if (external) {
    return (
      <li>
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">
          {children}
        </a>
      </li>
    );
  }
  return (
    <li>
      <Link href={href} className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">
        {children}
      </Link>
    </li>
  );
}
