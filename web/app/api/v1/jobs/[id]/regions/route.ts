import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { readServerClientId } from "@/lib/server-client-id";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const clientId = !user
    ? (request.headers.get("x-client-id") ?? await readServerClientId())
    : null;

  const admin = createServiceRoleClient();
  const { data: job } = await admin
    .from("jobs")
    .select("user_id,client_id,is_example")
    .eq("id", id)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  const ok =
    (user && job.user_id === user.id) ||
    (!!clientId && job.client_id === clientId) ||
    job.is_example === true;
  if (!ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data: regions } = await admin
    .from("regions")
    .select("contig,start_bp,end_bp,score,bgc_type,type_score")
    .eq("job_id", id)
    .order("score", { ascending: false });

  return NextResponse.json({
    regions: (regions ?? []).map((r) => ({
      contig: r.contig,
      start: r.start_bp,
      end: r.end_bp,
      score: r.score,
      type: r.bgc_type,
      type_score: r.type_score,
    })),
  });
}
