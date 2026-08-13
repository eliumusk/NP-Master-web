"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/client";

export function LogoutButton() {
  const router = useRouter();
  const { t } = useI18n();
  return (
    <button
      onClick={async () => {
        const supabase = createClient();
        await supabase.auth.signOut();
        router.push("/");
        router.refresh();
      }}
      className="rounded-btn border border-white/[0.08] px-2.5 py-1 text-xs text-fg-muted transition hover:border-white/20 hover:text-fg"
    >
      {t.nav.logout}
    </button>
  );
}
