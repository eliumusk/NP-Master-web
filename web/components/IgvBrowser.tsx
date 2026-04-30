"use client";

import { useEffect, useRef, useState } from "react";

type Props = { fastaUrl: string; faiUrl: string; bedUrl: string; wigUrl?: string };

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

export function IgvBrowser({ fastaUrl, faiUrl, bedUrl, wigUrl }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const browserRef = useRef<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    (async () => {
      if (!ref.current) return;

      // Pre-fetch the BED so we can land on the first feature instead of the
      // (often empty) first contig.
      let initialLocus: string | undefined;
      try {
        const bedText = await fetch(bedUrl).then((r) => r.text());
        const firstLine = bedText.split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("track"));
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

      // Build tracks list. Critical to keep BED first so a wig failure can
      // never strip out the regions.
      const tracks: any[] = [
        {
          name: "BGC regions",
          type: "annotation",
          format: "bed",
          url: bedUrl,
          displayMode: "EXPANDED",
        },
      ];
      if (wigUrl) {
        tracks.push({
          name: "BGC score",
          type: "wig",
          format: "bedGraph",     // camelCase matches the in-file `track type=bedGraph` header
          url: wigUrl,
          height: 50,
          min: 0,
          max: 1,
          color: "#6366F1",
        });
      }

      try {
        const browser = await igv.createBrowser(ref.current, {
          reference: {
            id: "user_genome",
            fastaURL: fastaUrl,
            indexURL: faiUrl,
            wholeGenomeView: false,
          },
          locus: initialLocus,
          tracks,
        });
        browserRef.current = browser;
      } catch (e: any) {
        // If the wig track is what's breaking igv, retry without it so the
        // user at least sees the regions.
        if (wigUrl) {
          console.warn("igv create failed with wig, retrying without:", e);
          try {
            const browser = await igv.createBrowser(ref.current, {
              reference: {
                id: "user_genome",
                fastaURL: fastaUrl,
                indexURL: faiUrl,
                wholeGenomeView: false,
              },
              locus: initialLocus,
              tracks: tracks.filter((t) => t.format !== "bedGraph"),
            });
            browserRef.current = browser;
            return;
          } catch (e2) {
            console.error("igv retry without wig also failed:", e2);
          }
        }
        throw e;
      }
    })().catch((e) => {
      console.error("igv init failed:", e);
      setError(e?.message ?? String(e));
    });

    return () => {
      cancelled = true;
      const b = browserRef.current as { dispose?: () => void } | null;
      if (b && typeof b.dispose === "function") b.dispose();
      browserRef.current = null;
      if (ref.current) ref.current.innerHTML = "";
    };
  }, [fastaUrl, faiUrl, bedUrl, wigUrl]);

  return (
    <div className="space-y-2">
      <div
        ref={ref}
        className="min-h-[300px] w-full overflow-hidden rounded-card border border-border bg-surface"
      />
      {error && (
        <p className="text-xs text-rose-600">
          IGV 加载失败: {error}（数据已写入 Storage，CSV / BED / GenBank 都可正常下载）
        </p>
      )}
    </div>
  );
}
