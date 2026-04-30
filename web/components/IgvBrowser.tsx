"use client";

import { useEffect, useRef } from "react";

type Props = { fastaUrl: string; faiUrl: string; bedUrl: string };

declare global {
  interface Window {
    igv?: {
      createBrowser: (el: HTMLElement, opts: unknown) => Promise<unknown>;
    };
  }
}

const IGV_CDN_URL = "https://cdn.jsdelivr.net/npm/igv@2.15.11/dist/igv.min.js";

function loadIgv(): Promise<NonNullable<Window["igv"]>> {
  if (typeof window === "undefined") return Promise.reject(new Error("not in browser"));
  if (window.igv) return Promise.resolve(window.igv);

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${IGV_CDN_URL}"]`);
    const onReady = () => {
      if (window.igv) resolve(window.igv);
      else reject(new Error("igv script loaded but window.igv missing"));
    };
    if (existing) {
      if (window.igv) onReady();
      else existing.addEventListener("load", onReady);
      existing.addEventListener("error", () => reject(new Error("failed to load igv from CDN")));
      return;
    }
    const s = document.createElement("script");
    s.src = IGV_CDN_URL;
    s.async = true;
    s.onload = onReady;
    s.onerror = () => reject(new Error("failed to load igv from CDN"));
    document.head.appendChild(s);
  });
}

export function IgvBrowser({ fastaUrl, faiUrl, bedUrl }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const browserRef = useRef<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!ref.current) return;

      // Land IGV on the first BGC region instead of the (possibly empty) first contig.
      let initialLocus: string | undefined;
      try {
        const bedText = await fetch(bedUrl).then((r) => r.text());
        const firstLine = bedText.split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#"));
        if (firstLine) {
          const cols = firstLine.split("\t");
          if (cols.length >= 3) {
            const contig = cols[0];
            const start = Math.max(0, parseInt(cols[1], 10) - 5000);
            const end = parseInt(cols[2], 10) + 5000;
            initialLocus = `${contig}:${start}-${end}`;
          }
        }
      } catch (e) {
        console.warn("could not pre-fetch BED for initial locus:", e);
      }

      const igv = await loadIgv();
      if (cancelled || !ref.current) return;
      const browser = await igv.createBrowser(ref.current, {
        reference: {
          id: "user_genome",
          fastaURL: fastaUrl,
          indexURL: faiUrl,
          wholeGenomeView: false,
        },
        locus: initialLocus,
        tracks: [
          {
            name: "BGC regions",
            type: "annotation",
            format: "bed",
            url: bedUrl,
            displayMode: "EXPANDED",
          },
        ],
      });
      browserRef.current = browser;
    })().catch((e) => {
      console.error("igv init failed:", e);
    });

    return () => {
      cancelled = true;
      const b = browserRef.current as { dispose?: () => void } | null;
      if (b && typeof b.dispose === "function") b.dispose();
      browserRef.current = null;
      if (ref.current) ref.current.innerHTML = "";
    };
  }, [fastaUrl, faiUrl, bedUrl]);

  return <div ref={ref} className="w-full overflow-hidden rounded-md border border-slate-200 dark:border-slate-800" />;
}
