// Submit a job by NCBI accession instead of file upload. The server fetches
// from eutils, hashes, uploads to Storage, then inserts the job row.
//
// Sized to fit in Vercel serverless limits: typical NCBI nuccore record is
// 0.5-15 MB, well under the function memory and execution time.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { fetchAccessionFasta, sha256Hex } from "@/lib/ncbi";

const Body = z.object({
  accession: z.string().min(2).max(64),
  threshold: z.number().gt(0).lt(1).default(0.5),
  minLenBp: z.number().int().min(100).max(1_000_000).default(2000),
  clientId: z.string().uuid().optional(),
});

const ANON_MAX_BYTES = 25 * 1024 * 1024;
const AUTH_MAX_BYTES = 50 * 1024 * 1024;

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && !input.clientId) {
    return NextResponse.json({ error: "anonymous submissions require clientId" }, { status: 400 });
  }

  // 1. Fetch FASTA from NCBI.
  let fasta: string, bytes: number;
  try {
    const r = await fetchAccessionFasta(input.accession);
    fasta = r.fasta; bytes = r.bytes;
  } catch (e: any) {
    return NextResponse.json({ error: `NCBI fetch failed: ${e.message ?? e}` }, { status: 502 });
  }

  // 2. Per-tier size cap.
  const cap = user ? AUTH_MAX_BYTES : ANON_MAX_BYTES;
  if (bytes > cap) {
    return NextResponse.json({
      error: `Fetched ${(bytes / 1024 / 1024).toFixed(1)} MB exceeds limit ${(cap / 1024 / 1024).toFixed(0)} MB${user ? "" : " (anonymous)"}.`,
    }, { status: 413 });
  }

  // 3. Hash + upload to Storage.
  const sha = await sha256Hex(fasta);
  const ownerKey = user?.id ?? `anon/${input.clientId!}`;
  const objectKey = `${ownerKey}/${sha}.fasta`;
  const bucket = process.env.FASTA_BUCKET ?? "fasta-uploads";
  const admin = createServiceRoleClient();

  const { error: uploadErr } = await admin.storage
    .from(bucket)
    .upload(objectKey, fasta, { contentType: "text/plain", upsert: true });
  if (uploadErr) {
    return NextResponse.json({ error: `storage upload: ${uploadErr.message}` }, { status: 500 });
  }

  // 4. Insert job.
  const insertRow: Record<string, unknown> = {
    fasta_path: objectKey,
    fasta_sha256: sha,
    fasta_bytes: bytes,
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
    accession: input.accession,
    bytes,
    sha256: sha,
  });
}
