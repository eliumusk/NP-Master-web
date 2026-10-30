import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "./index";

export async function getServerLocale(): Promise<Locale> {
  const store = await cookies();
  return resolveLocale(store.get(LOCALE_COOKIE)?.value);
}
