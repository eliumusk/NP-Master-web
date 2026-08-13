import "./globals.css";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Noto_Sans_SC } from "next/font/google";
import { getOptionalUser } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
import { I18nProvider } from "@/lib/i18n/client";
import { getDictionary } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n/server";

const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  variable: "--font-inter",
  display: "swap",
});

const jbMono = localFont({
  src: "./fonts/JetBrainsMonoVariable.woff2",
  variable: "--font-jbmono",
  display: "swap",
});

const notoSC = Noto_Sans_SC({
  variable: "--font-noto-sc",
  display: "swap",
  preload: false, // CJK uses unicode-range slices; nothing meaningful to preload
});

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  return {
    title: "BGCMaster",
    description: locale === "en"
      ? "BGC region detection, type classification, safety tiering and annotation for bacterial genomes."
      : "面向细菌基因组的 BGC 区域检测、类型分类、安全分级和注释工作流。",
  };
}

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#04070d" }],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [user, locale] = await Promise.all([getOptionalUser(), getServerLocale()]);
  const t = getDictionary(locale);

  return (
    <html lang={locale === "en" ? "en" : "zh-CN"} className={`${inter.variable} ${jbMono.variable} ${notoSC.variable}`}>
      <body className="min-h-screen bg-bg font-sans text-fg antialiased">
        <I18nProvider locale={locale}>
          <SiteHeader email={user?.email ?? null} />
          <main className="mx-auto w-full max-w-[92rem] px-5 py-8">{children}</main>
          <footer className="mx-auto w-full max-w-[92rem] px-5 pb-8 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-5 text-xs text-fg-subtle">
              <span>{t.footer.methods}</span>
              <span className="numeric-display">bgcmaster.bio</span>
            </div>
          </footer>
        </I18nProvider>
      </body>
    </html>
  );
}
