// Server-side Cloudflare Turnstile verification.

export async function verifyTurnstile(token: string, remoteip?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("TURNSTILE_SECRET not set; allowing in non-production.");
      return true;
    }
    return false;
  }
  const body = new URLSearchParams({ secret, response: token });
  if (remoteip) body.set("remoteip", remoteip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  if (!r.ok) return false;
  const j = (await r.json()) as { success?: boolean };
  return Boolean(j.success);
}
