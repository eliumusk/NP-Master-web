"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getDictionary, LOCALE_COOKIE, type Locale } from "./index";
import type { Dictionary } from "./zh";

type I18nValue = { locale: Locale; t: Dictionary; setLocale: (l: Locale) => void };

const I18nContext = createContext<I18nValue>({
  locale: "zh",
  t: getDictionary("zh"),
  setLocale: () => {},
});

export function I18nProvider({ locale: serverLocale, children }: { locale: Locale; children: React.ReactNode }) {
  // Optimistic locale: client-rendered text switches instantly on click;
  // router.refresh() then syncs server-rendered text in the background.
  const [locale, setLocale] = useState(serverLocale);
  useEffect(() => setLocale(serverLocale), [serverLocale]);
  const value = useMemo<I18nValue>(() => ({ locale, t: getDictionary(locale), setLocale }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function useSetLocale() {
  const router = useRouter();
  const { setLocale } = useContext(I18nContext);
  return (locale: Locale) => {
    setLocale(locale);
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
}
