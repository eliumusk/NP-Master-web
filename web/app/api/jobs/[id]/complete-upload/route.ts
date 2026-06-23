import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient, getOptionalUser } from "@/lib/supabase/server";
import { CompleteUpload } from "@/lib/schemas";
import { readServerClientId } from "@/lib/server-client-id";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = await request.json().catch(() => ({}));
  const parsed = CompleteUpload.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "请求格式无效", details: parsed.error.flatten() }, { status: 400 });
  }

  const user = await getOptionalUser();
  const clientId = !user ? (parsed.data.clientId ?? await readServerClientId()) : null;
  const admin = createServiceRoleClient();

  const { data: job } = await admin
    .from("jobs")
    .select("id,user_id,client_id,status")
    .eq("id", id)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (!ownsJob(job, user?.id ?? null, clientId)) {
    return NextResponse.json({ error: "没有访问该任务的权限" }, { status: 403 });
  }
  if (job.status !== "awaiting_upload") {
    return NextResponse.json({ ok: true, status: job.status });
  }

  const { data: genomes } = await admin
    .from("genomes")
    .select("id")
    .eq("job_id", id);
  if (!genomes || genomes.length === 0) {
    return NextResponse.json({ error: "任务中没有基因组文件" }, { status: 400 });
  }

  await admin.from("genomes").update({ status: "queued" }).eq("job_id", id);
  const { error } = await admin
    .from("jobs")
    .update({ status: "queued", log_tail: "已加入队列" })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, status: "queued" });
}

function ownsJob(job: { user_id: string | null; client_id: string | null }, userId: string | null, clientId: string | null) {
  return (!!userId && job.user_id === userId) || (!!clientId && job.client_id === clientId);
}
