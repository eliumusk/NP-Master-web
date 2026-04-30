// Public REST API for job creation. Mirrors /api/jobs/new but skips Turnstile
// (relies on rate-limit triggers + client_id namespacing instead).

import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { JobCreate } from "@/lib/schemas";

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
  const clientId = input.clientId ?? request.headers.get("x-client-id") ?? null;

  if (!user && !clientId) {
    return NextResponse.json({ error: "anonymous submissions require clientId in payload or x-client-id header" }, { status: 400 });
  }

  const cap = user ? AUTH_MAX_BYTES : ANON_MAX_BYTES;
  if (input.bytes > cap) {
    return NextResponse.json({
      error: `File is ${(input.bytes / 1024 / 1024).toFixed(1)} MB, limit is ${(cap / 1024 / 1024).toFixed(0)} MB.`,
    }, { status: 413 });
  }

  const ownerKey = user?.id ?? `anon/${clientId!}`;
  const objectKey = `${ownerKey}/${input.sha256}.fasta`;
  const filename = `${input.sha256}.fasta`;
  const bucket = process.env.FASTA_BUCKET ?? "fasta-uploads";
  const admin = createServiceRoleClient();

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

  const insertRow: Record<string, unknown> = {
    fasta_path: objectKey,
    fasta_sha256: input.sha256,
    fasta_bytes: input.bytes,
    threshold: input.threshold,
    min_len_bp: input.minLenBp,
  };
  if (user) insertRow.user_id = user.id;
  else insertRow.client_id = clientId;

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
    uploadUrl,           // null when the object already exists.
    objectKey,
    alreadyUploaded,
  });
}
