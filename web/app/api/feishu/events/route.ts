import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAllowedFeishuChat, sendFeishuCard } from "@/lib/feishu";
import { answerOpsCommand } from "@/lib/ops-status";

type FeishuEvent = {
  token?: string;
  type?: string;
  challenge?: string;
  header?: { token?: string; event_id?: string; event_type?: string };
  event?: {
    message?: { chat_id?: string; message_type?: string; content?: string };
  };
};

export async function POST(request: NextRequest) {
  let payload: FeishuEvent;
  try {
    payload = await request.json() as FeishuEvent;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const verificationToken = process.env.FEISHU_VERIFICATION_TOKEN;
  if (!verificationToken) return NextResponse.json({ error: "feishu not configured" }, { status: 503 });
  if ((payload.token ?? payload.header?.token) !== verificationToken) {
    return NextResponse.json({ error: "invalid verification token" }, { status: 401 });
  }
  if (payload.type === "url_verification") return NextResponse.json({ challenge: payload.challenge });
  if (payload.header?.event_type !== "im.message.receive_v1") return NextResponse.json({ ok: true });

  const eventId = payload.header.event_id;
  const chatId = payload.event?.message?.chat_id;
  if (!eventId || !chatId) return NextResponse.json({ error: "missing event data" }, { status: 400 });
  if (!isAllowedFeishuChat(chatId)) return NextResponse.json({ ok: true });

  const admin = createServiceRoleClient();
  const { error: dedupError } = await admin.from("ops_feishu_events").insert({ event_id: eventId });
  if (dedupError?.code === "23505") return NextResponse.json({ ok: true });
  if (dedupError) return NextResponse.json({ error: dedupError.message }, { status: 500 });

  try {
    const message = payload.event?.message;
    let text = "目前只支持文本命令，请发送“帮助”。";
    if (message?.message_type === "text" && message.content) {
      const content = JSON.parse(message.content) as { text?: string };
      text = await answerOpsCommand(admin, content.text ?? "");
    }
    await sendFeishuCard(chatId, "Genomine 后台监控", text);
    return NextResponse.json({ ok: true });
  } catch (error) {
    await admin.from("ops_feishu_events").delete().eq("event_id", eventId);
    console.error("Feishu event failed", error);
    return NextResponse.json({ error: "event processing failed" }, { status: 500 });
  }
}
