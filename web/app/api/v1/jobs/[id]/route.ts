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
  const { data: job, error } = await admin
    .from("jobs")
    .select("id,status,fasta_sha256,fasta_bytes,threshold,min_len_bp,created_at,started_at,finished_at,error,user_id,client_id,is_example")
    .eq("id", id)
    .maybeSingle();
  if (error || !job) return NextResponse.json({ error: "not found" }, { status: 404 });

  const ok =
    (user && job.user_id === user.id) ||
    (!!clientId && job.client_id === clientId) ||
    job.is_example === true;
  if (!ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Don't leak owner identifiers in API response.
  const { user_id, client_id, ...rest } = job;
  void user_id; void client_id;
  return NextResponse.json(rest);
}
