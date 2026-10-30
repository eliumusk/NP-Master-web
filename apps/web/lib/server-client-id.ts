import { cookies } from "next/headers";

const KEY = "npmaster_client_id";

export async function readServerClientId(): Promise<string | null> {
  const c = await cookies();
  return c.get(KEY)?.value ?? null;
}
