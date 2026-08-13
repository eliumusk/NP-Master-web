"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { functionClassColor, functionClassMeta } from "../constants";
import { formatBp } from "../format";
import type { CdsFeature, Region } from "../types";

// antiSMASH-style gene map: single centre lane, direction arrows, solid class
// colours with darker rims, gene labels when space allows, adaptive ruler.
// Laid out in real pixels (ResizeObserver) so text and strokes stay crisp.

const H = 148;
const LANE_Y = 56;      // centre of the gene lane
const GENE_H = 18;
const HEAD = 7;         // arrowhead px
const RULER_Y = 116;
const PAD = 10;

export function GeneTrack({ region }: { region: Region }) {
  const { t, locale } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(Math.floor(entries[0].contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cdsList = (region.cds_features ?? []).filter(
    (cds) => Number(cds.end ?? 0) > Number(cds.start ?? 0),
  );

  if (cdsList.length === 0) return null;

  const coreLen = region.end_bp - region.start_bp;
  const extStart = region.ext_start_bp != null ? region.ext_start_bp - region.start_bp : null;
  const extEnd = region.ext_end_bp != null ? region.ext_end_bp - region.start_bp : null;
  const minBp = Math.min(0, extStart ?? 0, ...cdsList.map((c) => Number(c.start ?? 0)));
  const maxBp = Math.max(coreLen, extEnd ?? coreLen, ...cdsList.map((c) => Number(c.end ?? 0)));
  const span = Math.max(1, maxBp - minBp);

  const innerW = Math.max(0, width - PAD * 2);
  const x = (bp: number) => PAD + ((bp - minBp) / span) * innerW;

  const classesPresent = Array.from(new Set(cdsList.map((c) => c.function_class || "other")));
  const ticks = width > 0 ? rulerTicks(minBp, maxBp, innerW) : [];

  return (
    <div className="mt-3">
      <div
        ref={wrapRef}
        className="overflow-hidden rounded-btn border border-white/[0.08] bg-[#070b13] px-0 pt-1"
      >
        {width > 0 && (
          <svg width={width} height={H} className="block" role="img" aria-label="gene map">
            {/* extended span */}
            {extStart != null && extEnd != null && (
              <rect
                x={x(extStart)}
                y={LANE_Y - 34}
                width={Math.max(1, x(extEnd) - x(extStart))}
                height={68}
                fill="rgb(var(--brand))"
                fillOpacity={0.05}
              />
            )}
            {/* core span */}
            <rect
              x={x(0)}
              y={LANE_Y - 34}
              width={Math.max(1, x(coreLen) - x(0))}
              height={68}
              fill="rgb(var(--brand))"
              fillOpacity={0.1}
              stroke="rgb(var(--brand))"
              strokeOpacity={0.55}
              strokeDasharray="4 3"
              rx={3}
            />
            {/* centre guide */}
            <line
              x1={PAD}
              x2={width - PAD}
              y1={LANE_Y}
              y2={LANE_Y}
              stroke="rgb(var(--border))"
              strokeOpacity={0.6}
            />

            {cdsList.map((cds, i) => (
              <GeneArrow key={`${cds.locus_tag ?? "cds"}-${i}`} cds={cds} x={x} locale={locale} hypothetical={t.detail.hypothetical} />
            ))}

            {/* ruler */}
            <line x1={PAD} x2={width - PAD} y1={RULER_Y} y2={RULER_Y} stroke="rgb(var(--border))" />
            {ticks.map((tick) => {
              const anchor = tick.px < PAD + 20 ? "start" : tick.px > width - PAD - 20 ? "end" : "middle";
              return (
                <g key={tick.bp}>
                  <line x1={tick.px} x2={tick.px} y1={RULER_Y} y2={RULER_Y + 4} stroke="rgb(var(--border))" />
                  <text
                    x={tick.px}
                    y={RULER_Y + 15}
                    textAnchor={anchor}
                    fontSize="9.5"
                    fill="rgb(var(--fg-subtle))"
                    fontFamily="var(--font-mono)"
                  >
                    {tick.label}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-fg-muted">
        {classesPresent.map((fc) => (
          <span key={fc} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: functionClassColor(fc) }} />
            {functionClassMeta(fc, locale).label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[2px] border border-fg-subtle/60 bg-transparent" />
          {t.detail.pfamDomain}
        </span>
        <span className="ml-auto font-mono text-fg-subtle">
          {t.detail.corePrefix} 0 – {formatBp(coreLen)}{extStart != null ? ` · ${t.detail.metaExt} ${formatBp(extStart)} – ${formatBp(extEnd ?? 0)}` : ""}
        </span>
      </div>
    </div>
  );
}

function GeneArrow({
  cds,
  x,
  locale,
  hypothetical,
}: {
  cds: CdsFeature;
  x: (bp: number) => number;
  locale: "zh" | "en";
  hypothetical: string;
}) {
  const start = Number(cds.start ?? 0);
  const end = Number(cds.end ?? 0);
  const strand = Number(cds.strand ?? 1);
  const x1 = x(start);
  const x2 = x(end);
  const w = Math.max(2, x2 - x1);
  const fc = cds.function_class || "other";
  const color = functionClassColor(fc);
  const rim = darken(color, 0.32);

  const y = LANE_Y - GENE_H / 2;
  const head = Math.min(HEAD, w * 0.4);

  // arrow polygon (direction = strand); plain block when too narrow
  const pts =
    w < head + 2
      ? `${x1},${y} ${x1 + w},${y} ${x1 + w},${y + GENE_H} ${x1},${y + GENE_H}`
      : strand < 0
        ? `${x1 + head},${y} ${x1 + w},${y} ${x1 + w},${y + GENE_H} ${x1 + head},${y + GENE_H} ${x1},${LANE_Y}`
        : `${x1},${y} ${x1 + w - head},${y} ${x1 + w},${LANE_Y} ${x1 + w - head},${y + GENE_H} ${x1},${y + GENE_H}`;

  const lengthAa = Number(cds.length_aa ?? 0);
  const domains = (cds.pfam_domains ?? []).filter(
    (d) => lengthAa > 0 && d.env_start != null && d.env_end != null && d.env_end > d.env_start,
  );

  const label = cds.locus_tag || "";
  const showLabel = label && w > 88 && Math.floor(w / 6.5) >= 8;

  return (
    <g className="cursor-default transition-opacity hover:opacity-85">
      <polygon points={pts} fill={color} stroke={rim} strokeWidth={1}>
        <title>{`${label || "CDS"} · ${cds.product || hypothetical}\n${start}–${end} bp (${strand < 0 ? "−" : "+"}) · ${functionClassMeta(fc, locale).label}`}</title>
      </polygon>
      {/* pfam domains: subtle light insets centred on the arrow body */}
      {domains.map((d, j) => {
        const fracS = Math.min(1, Math.max(0, Number(d.env_start) / lengthAa));
        const fracE = Math.min(1, Math.max(fracS, Number(d.env_end) / lengthAa));
        const dx1 = x(start + fracS * (end - start));
        const dx2 = x(start + fracE * (end - start));
        return (
          <rect
            key={`${d.accession ?? d.name ?? "dom"}-${j}`}
            x={dx1}
            y={y + GENE_H / 2 - 3}
            width={Math.max(2, dx2 - dx1)}
            height={6}
            fill="#ffffff"
            fillOpacity={0.35}
            stroke={rim}
            strokeWidth={0.5}
          >
            <title>{`${d.name ?? "Pfam"} ${d.accession ?? ""}${d.bitscore != null ? ` · bits ${Number(d.bitscore).toFixed(1)}` : ""}`}</title>
          </rect>
        );
      })}
      {showLabel && (
        <text
          x={x1 + w / 2}
          y={y - 5}
          textAnchor="middle"
          fontSize="10"
          fill="rgb(var(--fg-muted))"
          fontFamily="var(--font-mono)"
          pointerEvents="none"
        >
          {truncateToWidth(label, w)}
        </text>
      )}
    </g>
  );
}

function darken(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `rgb(${r},${g},${b})`;
}

function truncateToWidth(label: string, w: number) {
  const maxChars = Math.floor(w / 6.5);
  if (label.length <= maxChars) return label;
  return maxChars <= 1 ? "" : `${label.slice(0, maxChars - 1)}…`;
}

/** Adaptive ruler ticks at "nice" bp steps. */
function rulerTicks(minBp: number, maxBp: number, innerW: number) {
  const span = maxBp - minBp;
  const target = Math.max(1, Math.floor(innerW / 110));
  const rawStep = span / target;
  const pow = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rawStep) ?? 10 * pow;
  const first = Math.ceil(minBp / step) * step;
  const ticks: Array<{ bp: number; px: number; label: string }> = [];
  for (let bp = first; bp <= maxBp; bp += step) {
    ticks.push({ bp, px: 0, label: formatBp(bp) });
  }
  return ticks.map((t) => ({ ...t, px: PAD + ((t.bp - minBp) / span) * innerW }));
}
