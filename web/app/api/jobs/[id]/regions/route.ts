import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient, getOptionalUser } from "@/lib/supabase/server";
import { readServerClientId } from "@/lib/server-client-id";
import { trimRegionPayload } from "@/features/jobs/region-payload";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getOptionalUser();
  const clientId = !user
    ? (request.nextUrl.searchParams.get("client_id") ?? request.headers.get("x-client-id") ?? await readServerClientId())
    : null;
  const admin = createServiceRoleClient();

  const { data: job } = await admin
    .from("jobs")
    .select("id,user_id,client_id")
    .eq("id", id)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (!ownsJob(job, user?.id ?? null, clientId)) {
    return NextResponse.json({ error: "没有访问该任务的权限" }, { status: 403 });
  }

  const { data: regions } = await admin
    .from("regions")
    .select("id,genome_name,contig,start_bp,end_bp,ext_start_bp,ext_end_bp,score,bgc_type,type_score,type_scores,safe_tier,safe_pass,safe_type_label,mibig_hits,cds_features")
    .eq("job_id", id)
    .order("score", { ascending: false })
    .limit(1000);

  return NextResponse.json({ regions: trimRegionPayload(regions) });
}

function ownsJob(job: { user_id: string | null; client_id: string | null }, userId: string | null, clientId: string | null) {
  return (!!userId && job.user_id === userId) || (!!clientId && job.client_id === clientId);
}
