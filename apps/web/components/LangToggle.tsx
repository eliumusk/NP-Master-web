"use client";

import { useI18n, useSetLocale } from "@/lib/i18n/client";

export function LangToggle() {
  const { locale } = useI18n();
  const setLocale = useSetLocale();

  return (
    <div className="flex items-center rounded-btn border border-white/[0.08] bg-white/[0.02] p-0.5 text-micro font-medium">
      {(["zh", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          className={`rounded-[6px] px-2 py-1 transition-colors duration-150 ${
            locale === l ? "bg-elevated text-fg ring-1 ring-inset ring-white/[0.06]" : "text-fg-subtle hover:text-fg"
          }`}
          aria-pressed={locale === l}
        >
          {l === "zh" ? "中文" : "EN"}
        </button>
      ))}
    </div>
  );
}
