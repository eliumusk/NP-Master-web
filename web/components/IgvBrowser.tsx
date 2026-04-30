"use client";

import { useEffect, useRef } from "react";

type Props = { fastaUrl: string; faiUrl: string; bedUrl: string };

export function IgvBrowser({ fastaUrl, faiUrl, bedUrl }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const browserRef = useRef<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!ref.current) return;
      const mod: any = await import("igv");
      const igv = mod.default ?? mod;
      if (typeof igv?.createBrowser !== "function") {
        throw new Error("igv.createBrowser not found; package shape unexpected");
      }
      if (cancelled || !ref.current) return;
      const browser = await igv.createBrowser(ref.current, {
        reference: {
          id: "user_genome",
          fastaURL: fastaUrl,
          indexURL: faiUrl,
          wholeGenomeView: false,
        },
        tracks: [
          {
            name: "BGC regions",
            type: "annotation",
            format: "bed",
            url: bedUrl,
            displayMode: "EXPANDED",
            color: "#7c3aed",
          },
        ],
      });
      browserRef.current = browser;
    })().catch((e) => {
      console.error("igv init failed:", e);
    });

    return () => {
      cancelled = true;
      // igv exposes removeBrowser to clean up subscriptions.
      const b = browserRef.current as { dispose?: () => void } | null;
      if (b && typeof b.dispose === "function") b.dispose();
      browserRef.current = null;
      if (ref.current) ref.current.innerHTML = "";
    };
  }, [fastaUrl, faiUrl, bedUrl]);

  return <div ref={ref} className="w-full overflow-hidden rounded-md border border-slate-200 dark:border-slate-800" />;
}
