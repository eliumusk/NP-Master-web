import Link from "next/link";
import { createServiceRoleClient, getOptionalUser } from "@/lib/supabase/server";
import { readServerClientId } from "@/lib/server-client-id";
import { JobsList } from "@/components/JobsList";
import { getDictionary } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const [user, locale] = await Promise.all([getOptionalUser(), getServerLocale()]);
  const t = getDictionary(locale);
  const clientId = !user ? await readServerClientId() : null;
  const admin = createServiceRoleClient();

  let query = admin
    .from("jobs")
    .select("id,title,status,n_genomes,n_regions,n_safe,created_at,error")
    .order("created_at", { ascending: false })
    .limit(50);
  query = user ? query.eq("user_id", user.id) : clientId ? query.eq("client_id", clientId) : query.is("id", null);
  const { data: jobs } = await query;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.jobs.title}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {user ? (
              <>
                {t.jobs.subtitleAuthed}
                <span className="font-mono text-fg">{user.email}</span>
              </>
            ) : (
              t.jobs.subtitleAnon
            )}
          </p>
        </div>
        <Link href="/submit" className="btn-primary rounded-btn px-4 py-2 text-sm font-semibold">
          {t.jobs.newJob}
        </Link>
      </div>
      <JobsList jobs={jobs ?? []} t={t.jobs} statusLabels={t.status} locale={locale} />
    </div>
  );
}
