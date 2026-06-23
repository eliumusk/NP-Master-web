import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export function getPublicSupabaseKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ?? "";
}

export function hasPublicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = getPublicSupabaseKey();
  return !!url && !!key && !url.includes("YOUR-PROJECT") && key !== "ey..." && key.length > 20;
}

export async function getOptionalUser() {
  if (!hasPublicSupabaseConfig()) return null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
}

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("YOUR-PROJECT")
      ? process.env.NEXT_PUBLIC_SUPABASE_URL
      : process.env.SUPABASE_URL)!,
    getPublicSupabaseKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Ignored: setAll is called from a Server Component where mutating
            // cookies is not allowed. Middleware refreshes the session anyway.
          }
        },
      },
    },
  );
}

export function createServiceRoleClient() {
  // Used in route handlers that need to act with elevated privileges
  // (e.g. signing storage URLs, writing rows on behalf of a verified user).
  const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
  return createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
