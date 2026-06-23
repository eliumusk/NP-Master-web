import Link from "next/link";
import { createServiceRoleClient, getOptionalUser } from "@/lib/supabase/server";
import { readServerClientId } from "@/lib/server-client-id";
import { JobsList } from "@/components/JobsList";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const user = await getOptionalUser();
  const clientId = !user ? await readServerClientId() : null;
  const admin = createServiceRoleClient();

  let query = admin
    .from("jobs")
    .select("id,title,status,n_genomes,n_regions,n_safe,created_at,started_at,finished_at,error,log_tail")
    .order("created_at", { ascending: false })
    .limit(50);
  query = user ? query.eq("user_id", user.id) : clientId ? query.eq("client_id", clientId) : query.is("id", null);
  const { data: jobs } = await query;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">任务记录</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {user ? `当前登录：${user.email}` : "匿名任务会绑定到当前浏览器。"}
          </p>
        </div>
        <Link href="/submit" className="rounded-btn bg-brand px-4 py-2 text-sm font-medium text-brand-fg">
          新建任务
        </Link>
      </div>
      <JobsList jobs={jobs ?? []} />
    </div>
  );
}
