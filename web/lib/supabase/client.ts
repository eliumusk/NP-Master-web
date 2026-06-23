import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ?? "";
  if (!url || url.includes("YOUR-PROJECT") || !key || key === "ey...") {
    throw new Error("Supabase public auth config is not set");
  }
  return createBrowserClient(
    url,
    key,
  );
}
