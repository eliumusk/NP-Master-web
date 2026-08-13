import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServiceRoleClient, getOptionalUser } from "@/lib/supabase/server";

const FeedbackUpsert = z.object({
  regionId: z.number().int().positive().nullable(),
  rating: z.enum(["accurate", "partial", "inaccurate"]),
  comment: z.string().max(2000).default(""),
});

// GET: current user's feedback rows for this job
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("feedback")
    .select("id,region_id,rating,comment,updated_at")
    .eq("job_id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ feedback: data ?? [] });
}

// POST: create or update one rating (per region, or job-level when regionId is null)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "提交反馈需要先登录" }, { status: 401 });

  const parsed = FeedbackUpsert.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "请求格式无效", details: parsed.error.flatten() }, { status: 400 });
  }
  const { regionId, rating, comment } = parsed.data;

  const admin = createServiceRoleClient();

  // ownership: only the job owner can rate its regions
  const { data: job } = await admin.from("jobs").select("id,user_id").eq("id", id).maybeSingle();
  if (!job || job.user_id !== user.id) {
    return NextResponse.json({ error: "没有访问该任务的权限" }, { status: 403 });
  }

  const query = admin
    .from("feedback")
    .select("id")
    .eq("job_id", id)
    .eq("user_id", user.id);
  const { data: existing } = regionId == null
    ? await query.is("region_id", null).maybeSingle()
    : await query.eq("region_id", regionId).maybeSingle();

  if (existing) {
    const { error } = await admin
      .from("feedback")
      .update({ rating, comment, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id: existing.id });
  }

  const { data, error } = await admin
    .from("feedback")
    .insert({ user_id: user.id, job_id: id, region_id: regionId, rating, comment })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}
