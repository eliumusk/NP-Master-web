import { zh, type Dictionary } from "./zh";
import { en } from "./en";

export type Locale = "zh" | "en";
export type { Dictionary };
export const LOCALE_COOKIE = "bgc_locale";

export function resolveLocale(value: string | null | undefined): Locale {
  return value === "en" ? "en" : "zh";
}

export function getDictionary(locale: Locale): Dictionary {
  return locale === "en" ? en : zh;
}
