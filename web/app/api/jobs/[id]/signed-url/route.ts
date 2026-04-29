import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

const ALLOWED = new Set(["csv", "bed", "fai", "fasta"]);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const kind = request.nextUrl.searchParams.get("kind") ?? "csv";
  if (!ALLOWED.has(kind)) {
    return NextResponse.json({ error: "kind must be one of csv|bed|fai|fasta" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // RLS ensures the user can only read their own job row.
  const { data: job, error } = await supabase
    .from("jobs")
    .select("result_csv_path,result_bed_path,result_fai_path,result_fasta_path,status")
    .eq("id", id)
    .maybeSingle();
  if (error || !job) return NextResponse.json({ error: "not found" }, { status: 404 });

  const key =
    kind === "csv" ? job.result_csv_path :
    kind === "bed" ? job.result_bed_path :
    kind === "fai" ? job.result_fai_path :
    job.result_fasta_path;
  if (!key) return NextResponse.json({ error: `result not yet available (${kind})` }, { status: 409 });

  const admin = createServiceRoleClient();
  const bucket = process.env.RESULTS_BUCKET ?? "results";
  const { data: signed, error: sErr } = await admin.storage
    .from(bucket)
    .createSignedUrl(key, 60 * 10); // 10 min
  if (sErr || !signed) {
    return NextResponse.json({ error: `sign failed: ${sErr?.message ?? "unknown"}` }, { status: 500 });
  }
  return NextResponse.json({ url: signed.signedUrl });
}
