let cachedToken = "";
let tokenExpiresAt = 0;

export function isAllowedFeishuChat(chatId: string) {
  const allowed = process.env.FEISHU_ALLOWED_CHAT_IDS
    ?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  const configured = allowed.length
    ? allowed
    : (process.env.FEISHU_CHAT_ID ? [process.env.FEISHU_CHAT_ID] : []);
  return configured.includes(chatId);
}

async function tenantAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) throw new Error("飞书应用凭据未配置");
  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    cache: "no-store",
  });
  const payload = await response.json() as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
    throw new Error(`获取飞书访问令牌失败：${payload.msg ?? response.status}`);
  }
  cachedToken = payload.tenant_access_token;
  tokenExpiresAt = Date.now() + (payload.expire ?? 7200) * 1000 - 300_000;
  return cachedToken;
}

export async function sendFeishuCard(chatId: string, title: string, text: string) {
  const token = await tenantAccessToken();
  const card = {
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: title }, template: "blue" },
    elements: [{ tag: "div", text: { tag: "lark_md", content: text } }],
  };
  const response = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ receive_id: chatId, msg_type: "interactive", content: JSON.stringify(card) }),
    cache: "no-store",
  });
  const payload = await response.json() as { code?: number; msg?: string };
  if (!response.ok || payload.code !== 0) {
    throw new Error(`发送飞书消息失败：${payload.msg ?? response.status}`);
  }
}
