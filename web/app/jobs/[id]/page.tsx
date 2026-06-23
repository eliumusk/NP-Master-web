import { notFound } from "next/navigation";
import { createServiceRoleClient, getOptionalUser } from "@/lib/supabase/server";
import { readServerClientId } from "@/lib/server-client-id";
import { getSignedJobArtifacts } from "@/lib/job-artifacts";
import { JobWorkspace } from "@/features/jobs/components/JobWorkspace";
import { trimRegionPayload } from "@/features/jobs/region-payload";

export const dynamic = "force-dynamic";

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ client_id?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const user = await getOptionalUser();
  const clientId = !user ? (query.client_id ?? await readServerClientId()) : null;
  const admin = createServiceRoleClient();

  const { data: job } = await admin
    .from("jobs")
    .select("id,title,status,error,log_tail,n_genomes,n_regions,n_safe,threshold,extend_threshold,min_support_windows,min_len_bp,safe_tier_min,extend_flank_bp,created_at,started_at,finished_at,user_id,client_id")
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();
  const owner = (!!user && job.user_id === user.id) || (!!clientId && job.client_id === clientId);
  if (!owner) notFound();

  const { data: genomes } = await admin
    .from("genomes")
    .select("id,genome_name,original_name,fasta_bytes,status,error,n_regions,n_safe,created_at,started_at,finished_at")
    .eq("job_id", id)
    .order("genome_name");

  const { data: regions } = await admin
    .from("regions")
    .select("id,genome_name,contig,start_bp,end_bp,ext_start_bp,ext_end_bp,score,bgc_type,type_score,type_scores,safe_tier,safe_pass,safe_type_label,mibig_hits,cds_features")
    .eq("job_id", id)
    .order("score", { ascending: false })
    .limit(1000);

  const artifacts = await getSignedJobArtifacts(admin, id);
  const { user_id, client_id, ...safeJob } = job;
  void user_id; void client_id;
  return (
    <JobWorkspace
      initialJob={safeJob}
      initialGenomes={genomes ?? []}
      initialRegions={trimRegionPayload(regions)}
      initialArtifacts={artifacts}
      clientIdOverride={query.client_id}
    />
  );
}
