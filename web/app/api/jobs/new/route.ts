import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { JobCreate } from "@/lib/schemas";
import { verifyTurnstile } from "@/lib/turnstile";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const raw = await request.json().catch(() => null);
  const parsed = JobCreate.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  if (!(await verifyTurnstile(input.turnstileToken, ip))) {
    return NextResponse.json({ error: "turnstile verification failed" }, { status: 400 });
  }

  // Path: <user_id>/<sha>.fasta — namespaced under the uploading user.
  const objectKey = `${user.id}/${input.sha256}.fasta`;
  const bucket = process.env.FASTA_BUCKET ?? "fasta-uploads";

  const admin = createServiceRoleClient();

  // Issue a signed PUT for direct browser upload.
  const { data: signedUpload, error: signErr } = await admin.storage
    .from(bucket)
    .createSignedUploadUrl(objectKey);
  if (signErr || !signedUpload) {
    return NextResponse.json({ error: `signed url failed: ${signErr?.message ?? "unknown"}` }, { status: 500 });
  }

  // Insert the job row as the user (rate-limit + RLS apply).
  const { data: job, error: insertErr } = await supabase
    .from("jobs")
    .insert({
      user_id: user.id,
      fasta_path: objectKey,
      fasta_sha256: input.sha256,
      fasta_bytes: input.bytes,
      threshold: input.threshold,
      min_len_bp: input.minLenBp,
    })
    .select("id")
    .single();
  if (insertErr || !job) {
    return NextResponse.json({ error: insertErr?.message ?? "insert failed" }, { status: 400 });
  }

  return NextResponse.json({
    jobId: job.id,
    uploadUrl: signedUpload.signedUrl,
    uploadToken: signedUpload.token,
    objectKey,
  });
}
