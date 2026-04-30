import Link from "next/link";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { readServerClientId } from "@/lib/server-client-id";
import { JobsTable } from "@/components/JobsTable";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const clientId = !user ? await readServerClientId() : null;

  let jobs: any[] = [];
  if (user) {
    const res = await supabase
      .from("jobs")
      .select("id,status,fasta_sha256,fasta_bytes,threshold,min_len_bp,created_at,started_at,finished_at,error,log_tail")
      .order("created_at", { ascending: false })
      .limit(50);
    jobs = res.data ?? [];
  } else if (clientId) {
    const admin = createServiceRoleClient();
    const res = await admin
      .from("jobs")
      .select("id,status,fasta_sha256,fasta_bytes,threshold,min_len_bp,created_at,started_at,finished_at,error,log_tail")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(50);
    jobs = res.data ?? [];
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">我的任务</h1>
          <p className="mt-1 text-sm text-slate-500">
            {user ? <>登录账号 <span className="text-slate-700 dark:text-slate-300">{user.email}</span> 下的全部任务。</>
                  : "匿名访问，仅显示当前浏览器提交的任务。"}
          </p>
        </div>
        <Link
          href="/submit"
          className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
        >
          新建任务
        </Link>
      </div>
      <JobsTable
        initialJobs={jobs}
        userId={user?.id ?? null}
        clientId={clientId ?? null}
      />
    </div>
  );
}
