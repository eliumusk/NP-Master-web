// Expanded view inside RegionTable. Renders a gene track SVG (CDS arrows by
// function class) + a CDS list with Pfam domain pills. Per region.

type PfamDomain = {
  name: string;
  accession: string;
  e_value: number;
  bitscore: number;
  env_start: number;
  env_end: number;
};

type CDSFeature = {
  locus_tag: string;
  start: number;          // genomic coords on the region slice (0-based offset)
  end: number;
  strand: 1 | -1;
  length_aa: number;
  product?: string;
  function_class: "core_biosynthetic" | "additional_biosynthetic" | "transport"
                | "regulatory" | "resistance" | "other";
  pfam_domains: PfamDomain[];
};

const CLASS_FILL: Record<CDSFeature["function_class"], string> = {
  core_biosynthetic:       "#dc2626", // red-600
  additional_biosynthetic: "#f472b6", // pink-400
  transport:               "#2563eb", // blue-600
  regulatory:              "#16a34a", // green-600
  resistance:              "#9ca3af", // gray-400
  other:                   "#cbd5e1", // slate-300
};

const CLASS_LABEL: Record<CDSFeature["function_class"], string> = {
  core_biosynthetic:       "核心生合",
  additional_biosynthetic: "辅助生合",
  transport:               "运输",
  regulatory:              "调控",
  resistance:              "抗性",
  other:                   "其他",
};

export function RegionDetailPanel({
  cdsFeatures, regionStartBp, regionEndBp,
}: {
  cdsFeatures: CDSFeature[] | null | undefined;
  regionStartBp: number;
  regionEndBp: number;
}) {
  if (!cdsFeatures || cdsFeatures.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-border bg-elevated/40 p-6 text-center text-sm text-fg-muted">
        本区域暂无 CDS / Pfam 注释（可能 region 太短，或 hmmscan 未在阈值内命中域）。
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Legend />
      <GeneTrack cdsFeatures={cdsFeatures} />
      <CdsTable cdsFeatures={cdsFeatures} regionStartBp={regionStartBp} regionEndBp={regionEndBp} />
    </div>
  );
}

// ───────── Gene track SVG ─────────

function GeneTrack({ cdsFeatures }: { cdsFeatures: CDSFeature[] }) {
  const minBp = Math.min(...cdsFeatures.map((c) => c.start));
  const maxBp = Math.max(...cdsFeatures.map((c) => c.end));
  const span = Math.max(1, maxBp - minBp);
  const W = 880;          // viewBox width
  const PAD = 12;
  const drawW = W - 2 * PAD;
  const Y_BASE = 52;
  const ARROW_H = 14;

  const xOf = (bp: number) => PAD + ((bp - minBp) / span) * drawW;

  return (
    <div className="rounded-card border border-border bg-surface p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">基因轨道</span>
        <span className="numeric-display text-xs text-fg-subtle">{(span / 1000).toFixed(1)} kb · {cdsFeatures.length} CDS</span>
      </div>
      <svg viewBox={`0 0 ${W} 90`} className="h-auto w-full" role="img" aria-label="Region gene track">
        {/* Coordinate axis */}
        <line x1={PAD} y1={Y_BASE + ARROW_H + 6} x2={W - PAD} y2={Y_BASE + ARROW_H + 6}
              stroke="currentColor" className="text-fg-subtle" strokeOpacity="0.4" strokeWidth="1" />
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const bp = minBp + t * span;
          return (
            <g key={t}>
              <line x1={xOf(bp)} y1={Y_BASE + ARROW_H + 4} x2={xOf(bp)} y2={Y_BASE + ARROW_H + 10}
                    stroke="currentColor" className="text-fg-subtle" strokeWidth="1" />
              <text x={xOf(bp)} y={Y_BASE + ARROW_H + 22} textAnchor="middle"
                    className="fill-current text-fg-subtle" fontSize="9" fontFamily="ui-monospace">
                {fmtBp(bp - minBp)}
              </text>
            </g>
          );
        })}

        {/* Arrows per CDS */}
        {cdsFeatures.map((c, i) => {
          const x1 = xOf(c.start);
          const x2 = xOf(c.end);
          const w = Math.max(4, x2 - x1);
          const fill = CLASS_FILL[c.function_class] ?? CLASS_FILL.other;
          const tip = Math.min(8, w * 0.4);
          // Build an arrow polygon. tip on the right (strand=1) or left (strand=-1).
          const points = c.strand === 1
            ? `${x1},${Y_BASE} ${x1 + w - tip},${Y_BASE} ${x1 + w},${Y_BASE + ARROW_H / 2} ${x1 + w - tip},${Y_BASE + ARROW_H} ${x1},${Y_BASE + ARROW_H}`
            : `${x1 + tip},${Y_BASE} ${x1 + w},${Y_BASE} ${x1 + w},${Y_BASE + ARROW_H} ${x1 + tip},${Y_BASE + ARROW_H} ${x1},${Y_BASE + ARROW_H / 2}`;
          const tooltip = `${c.locus_tag} · ${CLASS_LABEL[c.function_class]} · ${c.length_aa} aa${
            c.pfam_domains.length ? ` · ${c.pfam_domains.map((d) => d.name).join(" / ")}` : ""
          }`;
          return (
            <g key={i}>
              <polygon points={points} fill={fill} fillOpacity="0.85" stroke={fill} strokeWidth="0.5">
                <title>{tooltip}</title>
              </polygon>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function fmtBp(bp: number): string {
  if (bp >= 1000) return `${(bp / 1000).toFixed(1)} kb`;
  return `${Math.round(bp)} bp`;
}

// ───────── Legend ─────────

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
      {(Object.keys(CLASS_FILL) as Array<CDSFeature["function_class"]>).map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-3 rounded-sm" style={{ backgroundColor: CLASS_FILL[k] }} />
          {CLASS_LABEL[k]}
        </span>
      ))}
    </div>
  );
}

// ───────── CDS table ─────────

function CdsTable({
  cdsFeatures, regionStartBp, regionEndBp,
}: {
  cdsFeatures: CDSFeature[];
  regionStartBp: number;
  regionEndBp: number;
}) {
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full text-sm">
        <thead className="bg-elevated/60 text-left text-xs uppercase tracking-wider text-fg-muted">
          <tr>
            <th className="px-3 py-2.5">#</th>
            <th className="px-3 py-2.5">Locus</th>
            <th className="px-3 py-2.5 text-right">起止 (在 region 内)</th>
            <th className="px-3 py-2.5 text-right">aa</th>
            <th className="px-3 py-2.5">功能</th>
            <th className="px-3 py-2.5">Pfam 域链 (N → C)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {cdsFeatures.map((c, i) => (
            <tr key={i} className="even:bg-elevated/20">
              <td className="numeric-display px-3 py-2.5 text-fg-muted">{i + 1}</td>
              <td className="px-3 py-2.5 font-mono text-xs">
                {c.locus_tag}
                <span className="ml-1 text-fg-subtle">{c.strand === 1 ? "→" : "←"}</span>
              </td>
              <td className="numeric-display px-3 py-2.5 text-right text-xs">
                {c.start.toLocaleString()}–{c.end.toLocaleString()}
              </td>
              <td className="numeric-display px-3 py-2.5 text-right text-sm">{c.length_aa}</td>
              <td className="px-3 py-2.5">
                <FunctionPill cls={c.function_class} />
              </td>
              <td className="px-3 py-2.5">
                {c.pfam_domains.length === 0 ? (
                  <span className="text-fg-subtle">—</span>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {c.pfam_domains.map((d, j) => (
                      <PfamPill key={j} domain={d} />
                    ))}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FunctionPill({ cls }: { cls: CDSFeature["function_class"] }) {
  const fill = CLASS_FILL[cls];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: fill + "22", color: fill }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: fill }} />
      {CLASS_LABEL[cls]}
    </span>
  );
}

function PfamPill({ domain }: { domain: PfamDomain }) {
  const acc = domain.accession.split(".")[0]; // PF00501.32 → PF00501 for InterPro
  const url = `https://www.ebi.ac.uk/interpro/entry/pfam/${acc}/`;
  const tooltip = `${domain.name} (${domain.accession})\nE = ${domain.e_value.toExponential(1)}, score ${domain.bitscore.toFixed(1)}\n${domain.env_start}-${domain.env_end} aa`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={tooltip}
      className="inline-flex items-center gap-1 rounded-pill border border-border bg-elevated/60 px-2 py-0.5 font-mono text-[11px] text-fg transition-colors hover:bg-brand-soft hover:text-brand"
    >
      {domain.name}
    </a>
  );
}
