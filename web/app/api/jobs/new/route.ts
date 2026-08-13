import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient, getOptionalUser } from "@/lib/supabase/server";
import { JobCreate } from "@/lib/schemas";

const ANON_MAX_BYTES = 10 * 1024 * 1024;
const AUTH_MAX_BYTES = 50 * 1024 * 1024;
const AUTH_MAX_FILES = 64;

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = JobCreate.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "请求格式无效", details: parsed.error.flatten() }, { status: 400 });
  }

  const input = parsed.data;
  const user = await getOptionalUser();
  if (!user && !input.clientId) {
    return NextResponse.json({ error: "匿名提交缺少浏览器标识" }, { status: 400 });
  }
  if (!user && input.genomes.length > 1) {
    return NextResponse.json({ error: "匿名模式一次只能提交一个 FASTA" }, { status: 403 });
  }
  if (user && input.genomes.length > AUTH_MAX_FILES) {
    return NextResponse.json({ error: `批量任务最多支持 ${AUTH_MAX_FILES} 个 FASTA 文件` }, { status: 413 });
  }

  const cap = user ? AUTH_MAX_BYTES : ANON_MAX_BYTES;
  const tooLarge = input.genomes.find((g) => g.bytes > cap);
  if (tooLarge) {
    return NextResponse.json({
      error: `${tooLarge.filename} 为 ${(tooLarge.bytes / 1024 / 1024).toFixed(1)} MB，限制为 ${(cap / 1024 / 1024).toFixed(0)} MB。`,
    }, { status: 413 });
  }

  const admin = createServiceRoleClient();
  const ownerKey = user?.id ?? `anon/${input.clientId}`;
  const bucket = process.env.FASTA_BUCKET ?? "fasta-uploads";

  const { data: job, error: jobErr } = await admin
    .from("jobs")
    .insert({
      user_id: user?.id ?? null,
      client_id: user ? null : input.clientId,
      title: input.title,
      source: "upload",
      status: "awaiting_upload",
      n_genomes: input.genomes.length,
      threshold: input.threshold,
      extend_threshold: input.extendThreshold,
      min_support_windows: input.minSupportWindows,
      min_len_bp: input.minLenBp,
      safe_tier_min: input.safeTierMin,
      extend_flank_bp: input.extendFlankBp,
      notify_email: user ? input.notifyEmail : false,
      log_tail: "等待 FASTA 上传",
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    return NextResponse.json({ error: jobErr?.message ?? "创建任务失败" }, { status: 500 });
  }

  const uploads = [];
  for (const genome of input.genomes) {
    const objectKey = `${ownerKey}/${job.id}/${genome.sha256}.fasta`;
    const { data: existing } = await admin.storage
      .from(bucket)
      .list(`${ownerKey}/${job.id}`, { search: `${genome.sha256}.fasta`, limit: 1 });
    const alreadyUploaded = !!existing?.some((o) => o.name === `${genome.sha256}.fasta`);

    let uploadUrl: string | null = null;
    if (!alreadyUploaded) {
      const { data: signed, error: signErr } = await admin.storage
        .from(bucket)
        .createSignedUploadUrl(objectKey);
      if (signErr || !signed) {
        return NextResponse.json({ error: `生成上传地址失败：${signErr?.message ?? "unknown"}` }, { status: 500 });
      }
      uploadUrl = signed.signedUrl;
    }

    // Optional GFF3 annotation attachment (activates the rescue/enhancement path)
    let gff3Path: string | null = null;
    let gff3UploadUrl: string | null = null;
    if (genome.gff3) {
      const gff3Ext = genome.gff3.filename.toLowerCase().endsWith(".gff") ? ".gff" : ".gff3";
      gff3Path = `${ownerKey}/${job.id}/${genome.gff3.sha256}${gff3Ext}`;
      const { data: gff3Existing } = await admin.storage
        .from(bucket)
        .list(`${ownerKey}/${job.id}`, { search: `${genome.gff3.sha256}${gff3Ext}`, limit: 1 });
      const gff3Already = !!gff3Existing?.some((o) => o.name === `${genome.gff3!.sha256}${gff3Ext}`);
      if (!gff3Already) {
        const { data: signed, error: signErr } = await admin.storage
          .from(bucket)
          .createSignedUploadUrl(gff3Path);
        if (signErr || !signed) {
          return NextResponse.json({ error: `生成 GFF3 上传地址失败：${signErr?.message ?? "unknown"}` }, { status: 500 });
        }
        gff3UploadUrl = signed.signedUrl;
      }
    }

    const { data: row, error: genomeErr } = await admin
      .from("genomes")
      .insert({
        job_id: job.id,
        genome_name: genome.genomeName,
        original_name: genome.filename,
        fasta_path: objectKey,
        fasta_sha256: genome.sha256,
        fasta_bytes: genome.bytes,
        gff3_path: gff3Path,
        status: alreadyUploaded ? "queued" : "awaiting_upload",
      })
      .select("id,genome_name")
      .single();
    if (genomeErr || !row) {
      return NextResponse.json({ error: genomeErr?.message ?? "创建基因组记录失败" }, { status: 500 });
    }

    uploads.push({
      genomeId: row.id,
      genomeName: row.genome_name,
      objectKey,
      uploadUrl,
      alreadyUploaded,
      gff3UploadUrl,
    });
  }

  const allUploaded = uploads.every((u) => u.alreadyUploaded);
  if (allUploaded) {
    await admin.from("jobs").update({ status: "queued", log_tail: "已加入队列" }).eq("id", job.id);
  }

  return NextResponse.json({ jobId: job.id, uploads });
}
