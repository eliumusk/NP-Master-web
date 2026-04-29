import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/LogoutButton";

export const metadata: Metadata = {
  title: "NP-Master — BGC region detection",
  description: "Upload a bacterial genome FASTA and discover BGC regions with a frozen Evo2 + per-token U-Net.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <header className="border-b border-slate-200 dark:border-slate-800">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-base font-semibold tracking-tight">
              NP-Master
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/submit" className="hover:underline">Submit</Link>
              <Link href="/jobs" className="hover:underline">Jobs</Link>
              <Link href="/about" className="hover:underline">About</Link>
              {user ? (
                <>
                  <span className="text-slate-500">{user.email}</span>
                  <LogoutButton />
                </>
              ) : (
                <Link href="/login" className="rounded-md bg-slate-900 px-3 py-1 text-white dark:bg-slate-100 dark:text-slate-900">
                  Sign in
                </Link>
              )}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 py-8 text-xs text-slate-500">
          Discovery-grade demo. Not a clinical or regulatory tool.
        </footer>
      </body>
    </html>
  );
}
