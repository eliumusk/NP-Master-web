import { notFound } from "next/navigation";
import { createServiceRoleClient, getOptionalUser } from "@/lib/supabase/server";
import { readServerClientId } from "@/lib/server-client-id";
import { getSignedJobArtifacts } from "@/lib/job-artifacts";
import { assignBgcIds } from "@/features/jobs/stats";
import { RegionDetailView } from "@/features/jobs/components/RegionDetailView";
import type { Region } from "@/features/jobs/types";

export const dynamic = "force-dynamic";

export default async function RegionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; regionId: string }>;
  searchParams: Promise<{ client_id?: string }>;
}) {
  const { id, regionId } = await params;
  const query = await searchParams;
  const user = await getOptionalUser();
  const clientId = !user ? (query.client_id ?? await readServerClientId()) : null;
  const admin = createServiceRoleClient();

  const { data: job } = await admin
    .from("jobs")
    .select("id,title,status,user_id,client_id")
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();
  const owner = (!!user && job.user_id === user.id) || (!!clientId && job.client_id === clientId);
  if (!owner) notFound();

  const regionIdNum = Number(regionId);
  if (!Number.isInteger(regionIdNum)) notFound();

  const [regionsRes, regionRes] = await Promise.all([
    admin
      .from("regions")
      .select("id,genome_name,contig,start_bp")
      .eq("job_id", id),
    admin
      .from("regions")
      .select("id,genome_name,contig,start_bp,end_bp,ext_start_bp,ext_end_bp,score,bgc_type,type_score,type_scores,safe_tier,safe_pass,safe_type_label,mibig_hits,cds_features")
      .eq("id", regionIdNum)
      .eq("job_id", id)
      .maybeSingle(),
  ]);
  const region = regionRes.data;
  if (!region) notFound();

  const { data: genome } = await admin
    .from("genomes")
    .select("id,genome_name,gff3_path")
    .eq("job_id", id)
    .eq("genome_name", region.genome_name)
    .maybeSingle();

  const allArtifacts = await getSignedJobArtifacts(admin, id);
  const genomeArtifacts = genome
    ? allArtifacts.filter((a) => a.genome_id === genome.id)
    : [];

  const bgcIds = assignBgcIds(regionsRes.data ?? []);
  const bgcId = bgcIds.get(region.id) ?? `R${region.id}`;
  const suffix = query.client_id ? `?client_id=${encodeURIComponent(query.client_id)}` : "";

  return (
    <RegionDetailView
      jobId={id}
      jobTitle={job.title}
      region={region as Region}
      bgcId={bgcId}
      genomeArtifacts={genomeArtifacts}
      isLoggedIn={!!user}
      annoSourceGff3={!!genome?.gff3_path}
      backHref={`/jobs/${id}${suffix}`}
    />
  );
}
