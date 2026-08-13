import { getOptionalUser } from "@/lib/supabase/server";
import { BatchSubmit } from "@/components/BatchSubmit";
import { getDictionary } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n/server";

export default async function SubmitPage() {
  const [user, locale] = await Promise.all([getOptionalUser(), getServerLocale()]);
  const t = getDictionary(locale);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.submit.pageTitle}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t.submit.pageSubtitle}</p>
      </div>
      <BatchSubmit isLoggedIn={!!user} />
    </div>
  );
}
