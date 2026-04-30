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

      // Fetch the BED first so we can land IGV on the first BGC region instead
      // of the (often features-less) first contig in the FASTA.
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
        locus: initialLocus,  // undefined → IGV's default (first contig)
        tracks: [
          {
            name: "BGC regions",
            type: "annotation",
            format: "bed",
            url: bedUrl,
            displayMode: "EXPANDED",
            // BED9 itemRgb sets per-feature color; no global color so IGV
            // renders each region in its type-specific color.
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
