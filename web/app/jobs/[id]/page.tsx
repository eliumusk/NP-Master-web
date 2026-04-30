import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { JobDetail } from "@/components/JobDetail";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/jobs/${id}`);

  const { data: job } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!job) notFound();

  const { data: regions } = await supabase
    .from("regions")
    .select("contig,start_bp,end_bp,score,bgc_type,type_score")
    .eq("job_id", id)
    .order("score", { ascending: false });

  return <JobDetail initialJob={job} initialRegions={regions ?? []} />;
}
