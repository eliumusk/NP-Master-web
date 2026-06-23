import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient, getOptionalUser } from "@/lib/supabase/server";
import { readServerClientId } from "@/lib/server-client-id";
import { getSignedJobArtifacts } from "@/lib/job-artifacts";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getOptionalUser();
  const clientId = !user
    ? (request.nextUrl.searchParams.get("client_id") ?? request.headers.get("x-client-id") ?? await readServerClientId())
    : null;
  const admin = createServiceRoleClient();

  const { data: job } = await admin
    .from("jobs")
    .select("id,title,status,error,log_tail,n_genomes,n_regions,n_safe,threshold,extend_threshold,min_support_windows,min_len_bp,safe_tier_min,extend_flank_bp,created_at,started_at,finished_at,user_id,client_id")
    .eq("id", id)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (!ownsJob(job, user?.id ?? null, clientId)) {
    return NextResponse.json({ error: "没有访问该任务的权限" }, { status: 403 });
  }

  const { data: genomes } = await admin
    .from("genomes")
    .select("id,genome_name,original_name,fasta_bytes,status,error,n_regions,n_safe,created_at,started_at,finished_at")
    .eq("job_id", id)
    .order("genome_name");

  const artifacts = await getSignedJobArtifacts(admin, id);
  const { user_id, client_id, ...safeJob } = job;
  void user_id; void client_id;
  return NextResponse.json({ job: safeJob, genomes: genomes ?? [], artifacts });
}

function ownsJob(job: { user_id: string | null; client_id: string | null }, userId: string | null, clientId: string | null) {
  return (!!userId && job.user_id === userId) || (!!clientId && job.client_id === clientId);
}
