import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { JobCreate } from "@/lib/schemas";
import { verifyTurnstile } from "@/lib/turnstile";

const ANON_MAX_BYTES = 25 * 1024 * 1024;
const AUTH_MAX_BYTES = 50 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = JobCreate.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Anon path requires a clientId (browser-generated UUID stored in localStorage).
  if (!user && !input.clientId) {
    return NextResponse.json({ error: "anonymous submissions require clientId" }, { status: 400 });
  }

  // Per-tier byte cap.
  const cap = user ? AUTH_MAX_BYTES : ANON_MAX_BYTES;
  if (input.bytes > cap) {
    return NextResponse.json({
      error: `File is ${(input.bytes / 1024 / 1024).toFixed(1)} MB, limit is ${(cap / 1024 / 1024).toFixed(0)} MB. ${user ? "" : "Sign in for higher limits, or split by contig."}`,
    }, { status: 413 });
  }

  // Turnstile is optional (enforced only when secret is configured).
  if (process.env.TURNSTILE_SECRET) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
    if (!input.turnstileToken || !(await verifyTurnstile(input.turnstileToken, ip))) {
      return NextResponse.json({ error: "turnstile verification failed" }, { status: 400 });
    }
  }

  // Storage path: namespace by user_id (auth) OR client_id (anon).
  const ownerKey = user?.id ?? `anon/${input.clientId!}`;
  const objectKey = `${ownerKey}/${input.sha256}.fasta`;
  const filename = `${input.sha256}.fasta`;
  const bucket = process.env.FASTA_BUCKET ?? "fasta-uploads";
  const admin = createServiceRoleClient();

  // If the same sha256 is already in this user's Storage namespace, skip the
  // upload step. The worker will pick up the existing object via the cached
  // path and (if features were also cached) finish in seconds.
  const { data: existingList } = await admin.storage
    .from(bucket)
    .list(ownerKey, { search: filename, limit: 1 });
  const alreadyUploaded = !!(existingList?.some((o) => o.name === filename));

  let uploadUrl: string | null = null;
  if (!alreadyUploaded) {
    const { data: signedUpload, error: signErr } = await admin.storage
      .from(bucket)
      .createSignedUploadUrl(objectKey);
    if (signErr || !signedUpload) {
      return NextResponse.json({ error: `signed url failed: ${signErr?.message ?? "unknown"}` }, { status: 500 });
    }
    uploadUrl = signedUpload.signedUrl;
  }

  // Insert via service role so anon paths and rate-limit triggers work uniformly.
  const insertRow: Record<string, unknown> = {
    fasta_path: objectKey,
    fasta_sha256: input.sha256,
    fasta_bytes: input.bytes,
    threshold: input.threshold,
    min_len_bp: input.minLenBp,
  };
  if (user) insertRow.user_id = user.id;
  else insertRow.client_id = input.clientId;

  const { data: job, error: insertErr } = await admin
    .from("jobs")
    .insert(insertRow)
    .select("id")
    .single();
  if (insertErr || !job) {
    return NextResponse.json({ error: insertErr?.message ?? "insert failed" }, { status: 400 });
  }

  return NextResponse.json({
    jobId: job.id,
    uploadUrl,           // null when the object already exists; client should skip PUT.
    objectKey,
    alreadyUploaded,
  });
}
