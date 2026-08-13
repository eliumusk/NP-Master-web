import { useI18n } from "@/lib/i18n/client";
import { functionClassColor, functionClassMeta } from "../constants";
import { formatBp } from "../format";
import type { CdsFeature, Region } from "../types";

// Genome-browser style track for one region. CDS coordinates in the payload
// are relative to the core region start (start_bp), so the core span is
// [0, coreLen] and the extended span may reach into negative / beyond.

const W = 1000;      // viewBox width (stretched to container)
const H = 152;       // viewBox height
const PLUS_Y = 30;   // + strand lane top
const MINUS_Y = 78;  // - strand lane top
const CDS_H = 24;    // arrow body height
const HEAD = 11;     // arrowhead length
const AXIS_Y = 136;

export function GeneTrack({ region }: { region: Region }) {
  const { t, locale } = useI18n();
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
  const rawX = (bp: number) => ((bp - minBp) / span) * W;
  const x = (bp: number) => Math.min(W, Math.max(0, rawX(bp)));

  const classesPresent = Array.from(new Set(cdsList.map((c) => c.function_class || "other")));

  return (
    <div className="mt-3">
      <div className="bg-grid-faint overflow-hidden rounded-btn border border-white/[0.06] bg-bg/70 px-2 pt-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-44 w-full"
          role="img"
          aria-label="基因轨道"
        >
          <defs>
            {classesPresent.map((fc) => (
              <linearGradient key={fc} id={`gtg-${fc}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={functionClassColor(fc)} stopOpacity="1" />
                <stop offset="100%" stopColor={functionClassColor(fc)} stopOpacity="0.62" />
              </linearGradient>
            ))}
            <linearGradient id="gt-core" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--brand))" stopOpacity="0.16" />
              <stop offset="100%" stopColor="rgb(var(--brand))" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {/* extended span band */}
          {extStart != null && extEnd != null && (
            <rect
              x={x(extStart)}
              y={12}
              width={Math.max(1, x(extEnd) - x(extStart))}
              height={AXIS_Y - 26}
              fill="rgb(var(--brand))"
              fillOpacity={0.05}
            />
          )}
          {/* core span band */}
          <rect
            x={x(0)}
            y={12}
            width={Math.max(1, x(coreLen) - x(0))}
            height={AXIS_Y - 26}
            fill="url(#gt-core)"
            stroke="rgb(var(--brand))"
            strokeOpacity={0.5}
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
          />
          {/* lane guides */}
          <line x1={0} x2={W} y1={PLUS_Y + CDS_H / 2} y2={PLUS_Y + CDS_H / 2} stroke="rgb(var(--border))" strokeOpacity={0.45} vectorEffect="non-scaling-stroke" />
          <line x1={0} x2={W} y1={MINUS_Y + CDS_H / 2} y2={MINUS_Y + CDS_H / 2} stroke="rgb(var(--border))" strokeOpacity={0.45} vectorEffect="non-scaling-stroke" />

          {cdsList.map((cds, i) => (
            <CdsArrow key={`${cds.locus_tag ?? "cds"}-${i}`} cds={cds} x={x} />
          ))}

          {/* axis */}
          <line x1={0} x2={W} y1={AXIS_Y} y2={AXIS_Y} stroke="rgb(var(--border))" vectorEffect="non-scaling-stroke" />
          {Array.from({ length: 11 }, (_, t) => (
            <line
              key={t}
              x1={(t * W) / 10}
              x2={(t * W) / 10}
              y1={AXIS_Y}
              y2={AXIS_Y + 5}
              stroke="rgb(var(--border))"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        <div className="flex justify-between px-1 pb-1.5 font-mono text-[11px] text-fg-subtle">
          <span>{minBp < 0 ? `−${formatBp(-minBp)}` : "0"}</span>
          <span>{t.detail.corePrefix} 0 – {formatBp(coreLen)}</span>
          <span>{formatBp(maxBp)}</span>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-fg-muted">
        {classesPresent.map((fc) => (
          <span key={fc} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-[3px]"
              style={{ backgroundColor: functionClassColor(fc) }}
            />
            {functionClassMeta(fc, locale).label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px] border border-fg-subtle/60 bg-bg" />
          {t.detail.pfamDomain}
        </span>
      </div>
    </div>
  );
}

function CdsArrow({ cds, x }: { cds: CdsFeature; x: (bp: number) => number }) {
  const { t, locale } = useI18n();
  const start = Number(cds.start ?? 0);
  const end = Number(cds.end ?? 0);
  const x1 = x(start);
  const x2 = x(end);
  const width = x2 - x1;
  const strand = Number(cds.strand ?? 1);
  const y = strand < 0 ? MINUS_Y : PLUS_Y;
  const fc = cds.function_class || "other";
  const color = functionClassColor(fc);

  let points: string;
  if (width < HEAD + 4) {
    points = `${x1},${y} ${x2},${y} ${x2},${y + CDS_H} ${x1},${y + CDS_H}`;
  } else if (strand < 0) {
    points = `${x1 + HEAD},${y} ${x2},${y} ${x2},${y + CDS_H} ${x1 + HEAD},${y + CDS_H} ${x1},${y + CDS_H / 2}`;
  } else {
    points = `${x1},${y} ${x2 - HEAD},${y} ${x2},${y + CDS_H / 2} ${x2 - HEAD},${y + CDS_H} ${x1},${y + CDS_H}`;
  }

  const lengthAa = Number(cds.length_aa ?? 0);
  const domains = (cds.pfam_domains ?? []).filter(
    (d) => lengthAa > 0 && d.env_start != null && d.env_end != null && d.env_end > d.env_start,
  );

  return (
    <g className="opacity-90 transition-opacity hover:opacity-100">
      <polygon
        points={points}
        fill={`url(#gtg-${fc})`}
        stroke={color}
        strokeOpacity={0.55}
        vectorEffect="non-scaling-stroke"
      >
        <title>
          {`${cds.locus_tag ?? "CDS"} · ${cds.product || t.detail.hypothetical}\n${start}–${end} bp (${strand < 0 ? "−" : "+"}) · ${functionClassMeta(fc, locale).label}`}
        </title>
      </polygon>
      {domains.map((d, j) => {
        const fracS = Math.min(1, Math.max(0, Number(d.env_start) / lengthAa));
        const fracE = Math.min(1, Math.max(fracS, Number(d.env_end) / lengthAa));
        const dx1 = x(start + fracS * (end - start));
        const dx2 = x(start + fracE * (end - start));
        return (
          <rect
            key={`${d.accession ?? d.name ?? "dom"}-${j}`}
            x={dx1}
            y={y + 6}
            width={Math.max(2, dx2 - dx1)}
            height={CDS_H - 12}
            rx={2}
            fill="rgb(var(--bg))"
            fillOpacity={0.78}
            stroke={color}
            strokeOpacity={0.9}
            vectorEffect="non-scaling-stroke"
          >
            <title>{`${d.name ?? "Pfam"} ${d.accession ?? ""}${d.bitscore != null ? ` · bits ${Number(d.bitscore).toFixed(1)}` : ""}`}</title>
          </rect>
        );
      })}
    </g>
  );
}
