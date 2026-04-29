import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { JobsTable } from "@/components/JobsTable";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/jobs");

  const { data: jobs } = await supabase
    .from("jobs")
    .select("id,status,fasta_sha256,fasta_bytes,threshold,min_len_bp,created_at,started_at,finished_at,error,log_tail")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your jobs</h1>
        <Link href="/submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900">
          New job
        </Link>
      </div>
      <JobsTable initialJobs={jobs ?? []} userId={user.id} />
    </div>
  );
}
