type MibigHit = { bgc_id: string; identity: number; product?: string };
type Region = {
  contig: string;
  start_bp: number;
  end_bp: number;
  score: number;
  bgc_type?: string | null;
  type_score?: number | null;
  mibig_hits?: MibigHit[] | null;
};

// BGC type → Tailwind classes (using bgc.* tokens from tailwind.config.ts).
// All seven keep the same HSL saturation/lightness so badges feel uniform.
const TYPE_CLASS: Record<string, string> = {
  Alkaloid:   "bg-bgc-alkaloid-soft   text-bgc-alkaloid-fg",
  Terpene:    "bg-bgc-terpene-soft    text-bgc-terpene-fg",
  NRP:        "bg-bgc-nrp-soft        text-bgc-nrp-fg",
  Polyketide: "bg-bgc-polyketide-soft text-bgc-polyketide-fg",
  RiPP:       "bg-bgc-ripp-soft       text-bgc-ripp-fg",
  Saccharide: "bg-bgc-saccharide-soft text-bgc-saccharide-fg",
  Other:      "bg-bgc-other-soft      text-bgc-other-fg",
};

function TypeBadge({ type }: { type: string | null | undefined }) {
  if (!type) return <span className="text-fg-subtle">—</span>;
  const cls = TYPE_CLASS[type] ?? TYPE_CLASS.Other;
  return (
    <span className={`inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium ${cls}`}>
      {type}
    </span>
  );
}

function MibigCell({ hits }: { hits: MibigHit[] | null | undefined }) {
  if (!hits || hits.length === 0) return <span className="text-fg-subtle">—</span>;
  const top = hits[0];
  const url = `https://mibig.secondarymetabolites.org/repository/${top.bgc_id}/`;
  return (
    <div className="space-y-0.5">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="numeric-display text-xs text-brand hover:underline"
        title={top.product || top.bgc_id}
      >
        {top.bgc_id}
      </a>
      <div className="text-[10px] text-fg-muted">
        <span className="numeric-display">{(top.identity * 100).toFixed(0)}%</span> id
        {top.product && <span className="ml-1 truncate">· {top.product.slice(0, 28)}</span>}
      </div>
    </div>
  );
}

export function RegionTable({ regions }: { regions: Region[] }) {
  if (regions.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-border bg-elevated/40 p-8 text-center">
        <p className="text-sm text-fg-muted">阈值上没有检出区域。试试预设里"高召回"。</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full text-sm">
        <colgroup>
          <col style={{ width: "3rem" }} />
          <col style={{ width: "7rem" }} />
          <col />
          <col style={{ width: "7rem" }} />
          <col style={{ width: "7rem" }} />
          <col style={{ width: "6rem" }} />
          <col style={{ width: "5rem" }} />
          <col style={{ width: "6rem" }} />
          <col style={{ width: "12rem" }} />
        </colgroup>
        <thead className="bg-elevated/60 text-left text-xs uppercase tracking-wider text-fg-muted">
          <tr>
            <th className="px-3 py-3">#</th>
            <th className="px-3 py-3">类型</th>
            <th className="px-3 py-3">Contig</th>
            <th className="px-3 py-3 text-right">Start</th>
            <th className="px-3 py-3 text-right">End</th>
            <th className="px-3 py-3 text-right">长度</th>
            <th className="px-3 py-3 text-right">分数</th>
            <th className="px-3 py-3 text-right">类型置信</th>
            <th className="px-3 py-3">最相似已知簇</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {regions.map((r, i) => (
            <tr key={i} className="even:bg-elevated/20 hover:bg-elevated/60">
              <td className="numeric-display px-3 py-3 text-fg-muted">{i + 1}</td>
              <td className="px-3 py-3"><TypeBadge type={r.bgc_type} /></td>
              <td className="px-3 py-3 font-mono text-xs">{r.contig}</td>
              <td className="numeric-display px-3 py-3 text-right text-sm">{r.start_bp.toLocaleString()}</td>
              <td className="numeric-display px-3 py-3 text-right text-sm">{r.end_bp.toLocaleString()}</td>
              <td className="numeric-display px-3 py-3 text-right text-sm">{(r.end_bp - r.start_bp).toLocaleString()}</td>
              <td className="numeric-display px-3 py-3 text-right text-sm">{r.score.toFixed(3)}</td>
              <td className="numeric-display px-3 py-3 text-right text-sm">
                {r.type_score == null ? "—" : r.type_score.toFixed(3)}
              </td>
              <td className="px-3 py-3"><MibigCell hits={r.mibig_hits ?? null} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
