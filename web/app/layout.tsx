import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { Toaster } from "sonner";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/LogoutButton";
import { Logo } from "@/components/Logo";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://np-master-web.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "NP-Master · 下一代 BGC 发现平台",
    template: "%s · NP-Master",
  },
  description: "基于基因组语言模型 Evo2 的 BGC 检测、类型分类、MIBiG 比对与可视化平台。上传细菌基因组 FASTA，几分钟内得到候选区域。",
  keywords: ["BGC", "biosynthetic gene cluster", "Evo2", "antiSMASH alternative", "MIBiG", "natural product discovery", "细菌次级代谢", "基因组挖掘"],
  authors: [{ name: "NP-Master" }],
  openGraph: {
    title: "NP-Master · 从基因组到 BGC，一站式发现与注释",
    description: "基于基因组语言模型 Evo2 的下一代 BGC 发现平台。16 GPU 并行 + MIBiG 比对 + IGV 可视化。",
    url: SITE_URL,
    siteName: "NP-Master",
    locale: "zh_CN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "NP-Master · 下一代 BGC 发现平台",
    description: "16 GPU 并行 · 7 类产物分类 · MIBiG 已知簇比对",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)",  color: "#020617" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <html lang="zh-CN" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-bg font-sans text-fg antialiased">
        <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-content items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <Logo className="h-6 w-6 text-brand" />
              <span>NP-Master</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <NavLink href="/submit">提交分析</NavLink>
              <NavLink href="/jobs">我的任务</NavLink>
              <NavLink href="/docs">文档</NavLink>
              <NavLink href="/about">关于</NavLink>
              {user ? (
                <div className="ml-2 flex items-center gap-2 border-l border-border pl-3">
                  <span className="hidden text-xs text-fg-muted sm:inline">{user.email}</span>
                  <LogoutButton />
                </div>
              ) : (
                <Link
                  href="/login"
                  className="ml-2 rounded-btn bg-brand px-3 py-1.5 font-medium text-brand-fg shadow-sm transition-colors hover:opacity-90"
                >
                  登录
                </Link>
              )}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-content px-4 py-12">{children}</main>
        <Footer />
        <Toaster richColors position="top-right" closeButton />
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-btn px-3 py-1.5 text-fg-muted transition-colors hover:bg-elevated hover:text-fg"
    >
      {children}
    </Link>
  );
}

function Footer() {
  return (
    <footer className="mt-section border-t border-border">
      <div className="mx-auto grid max-w-content gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <Logo className="h-5 w-5 text-brand" />
            <span className="text-sm font-semibold tracking-tight">NP-Master</span>
          </div>
          <p className="mt-3 text-xs text-fg-muted">基因组语言模型驱动的 BGC 发现与注释平台。</p>
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
          <FooterLink href="/about#roadmap">路线图</FooterLink>
        </FooterCol>
        <FooterCol title="关于">
          <FooterLink href="/about">方法 & 评测</FooterLink>
          <FooterLink href="/about#contact">联系</FooterLink>
          <FooterLink href="/about#license">License</FooterLink>
          <FooterLink href="/about#privacy">隐私</FooterLink>
        </FooterCol>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto max-w-content px-4 py-4 text-center text-xs text-fg-subtle">
          NP-Master · 学术研究用途 · © {new Date().getFullYear()}
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-fg">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children, external }: { href: string; children: React.ReactNode; external?: boolean }) {
  const cls = "text-fg-muted hover:text-fg transition-colors";
  if (external) {
    return (
      <li>
        <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{children}</a>
      </li>
    );
  }
  return <li><Link href={href} className={cls}>{children}</Link></li>;
}
