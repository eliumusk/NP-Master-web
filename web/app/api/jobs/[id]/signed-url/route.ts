import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { readServerClientId } from "@/lib/server-client-id";

const ALLOWED = new Set(["csv", "bed", "fai", "fasta"]);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const kind = request.nextUrl.searchParams.get("kind") ?? "csv";
  if (!ALLOWED.has(kind)) {
    return NextResponse.json({ error: "kind must be one of csv|bed|fai|fasta" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const clientId = !user ? await readServerClientId() : null;
  const admin = createServiceRoleClient();

  const { data: job, error } = await admin
    .from("jobs")
    .select("user_id,client_id,is_example,result_csv_path,result_bed_path,result_fai_path,result_fasta_path,status")
    .eq("id", id)
    .maybeSingle();
  if (error || !job) return NextResponse.json({ error: "not found" }, { status: 404 });

  const ok =
    (user && job.user_id === user.id) ||
    (!!clientId && job.client_id === clientId) ||
    job.is_example === true;
  if (!ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const key =
    kind === "csv" ? job.result_csv_path :
    kind === "bed" ? job.result_bed_path :
    kind === "fai" ? job.result_fai_path :
    job.result_fasta_path;
  if (!key) return NextResponse.json({ error: `result not yet available (${kind})` }, { status: 409 });

  const bucket = process.env.RESULTS_BUCKET ?? "results";
  const { data: signed, error: sErr } = await admin.storage
    .from(bucket)
    .createSignedUrl(key, 60 * 10);
  if (sErr || !signed) {
    return NextResponse.json({ error: `sign failed: ${sErr?.message ?? "unknown"}` }, { status: 500 });
  }
  return NextResponse.json({ url: signed.signedUrl });
}
