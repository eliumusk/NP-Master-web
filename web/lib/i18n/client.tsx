"use client";

import { createContext, useContext } from "react";
import { useRouter } from "next/navigation";
import { getDictionary, LOCALE_COOKIE, type Locale } from "./index";
import type { Dictionary } from "./zh";

const I18nContext = createContext<{ locale: Locale; t: Dictionary }>({
  locale: "zh",
  t: getDictionary("zh"),
});

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return (
    <I18nContext.Provider value={{ locale, t: getDictionary(locale) }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export function useSetLocale() {
  const router = useRouter();
  return (locale: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
}
