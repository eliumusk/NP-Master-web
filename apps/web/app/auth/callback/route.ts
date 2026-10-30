import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient, hasPublicSupabaseConfig } from "@/lib/supabase/server";

// Magic-link redirect target. Handles both Supabase auth flows:
//   - PKCE / OAuth code:        ?code=...
//   - Email OTP token hash:     ?token_hash=...&type=magiclink
// On success forwards to ?next= (default /jobs); on failure to /login?error=...
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") ?? "/jobs";

  if (!hasPublicSupabaseConfig()) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent("Supabase 公开认证配置未设置")}`, url.origin),
    );
  }

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin),
      );
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin),
      );
    }
  } else {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent("登录回调缺少必要参数")}`, url.origin),
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
