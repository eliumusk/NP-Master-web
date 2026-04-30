import { notFound } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { readServerClientId } from "@/lib/server-client-id";
import { JobDetail } from "@/components/JobDetail";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const clientId = !user ? await readServerClientId() : null;
  const admin = createServiceRoleClient();

  // Fetch via service-role so we can serve example + anon + auth flows uniformly,
  // then enforce authorization in the route.
  const { data: job } = await admin
    .from("jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();

  const isOwner =
    (user && job.user_id === user.id) ||
    (!!clientId && job.client_id === clientId) ||
    job.is_example === true;
  if (!isOwner) notFound();

  const { data: regions } = await admin
    .from("regions")
    .select("contig,start_bp,end_bp,score,bgc_type,type_score,mibig_hits")
    .eq("job_id", id)
    .order("score", { ascending: false });

  return <JobDetail initialJob={job} initialRegions={regions ?? []} isExample={!!job.is_example} />;
}
