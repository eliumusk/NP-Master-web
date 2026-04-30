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

const TYPE_COLOR: Record<string, string> = {
  Alkaloid:   "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200",
  Terpene:    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  NRP:        "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200",
  Polyketide: "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200",
  RiPP:       "bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-200",
  Saccharide: "bg-pink-100 text-pink-800 dark:bg-pink-950/60 dark:text-pink-200",
  Other:      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

function TypeBadge({ type }: { type: string | null | undefined }) {
  if (!type) return <span className="text-slate-400">—</span>;
  const cls = TYPE_COLOR[type] ?? TYPE_COLOR.Other;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {type}
    </span>
  );
}

function MibigCell({ hits }: { hits: MibigHit[] | null | undefined }) {
  if (!hits || hits.length === 0) return <span className="text-slate-400">—</span>;
  const top = hits[0];
  const url = `https://mibig.secondarymetabolites.org/repository/${top.bgc_id}/`;
  return (
    <div className="space-y-0.5">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-xs text-indigo-600 hover:underline dark:text-indigo-400"
        title={top.product || top.bgc_id}
      >
        {top.bgc_id}
      </a>
      <div className="text-[10px] tabular-nums text-slate-500">
        {(top.identity * 100).toFixed(0)}% id
        {top.product && <span className="ml-1 truncate">· {top.product.slice(0, 28)}</span>}
      </div>
    </div>
  );
}

export function RegionTable({ regions }: { regions: Region[] }) {
  if (regions.length === 0) {
    return <p className="text-sm text-slate-500">阈值上没有检出区域。</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500 dark:bg-slate-900/60">
          <tr>
            <th className="px-3 py-2.5">#</th>
            <th className="px-3 py-2.5">类型</th>
            <th className="px-3 py-2.5">Contig</th>
            <th className="px-3 py-2.5 text-right">Start</th>
            <th className="px-3 py-2.5 text-right">End</th>
            <th className="px-3 py-2.5 text-right">长度</th>
            <th className="px-3 py-2.5 text-right">分数</th>
            <th className="px-3 py-2.5 text-right">类型置信</th>
            <th className="px-3 py-2.5">最相似已知簇</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {regions.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40">
              <td className="px-3 py-2.5 text-slate-500">{i + 1}</td>
              <td className="px-3 py-2.5"><TypeBadge type={r.bgc_type} /></td>
              <td className="px-3 py-2.5 font-mono text-xs">{r.contig}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{r.start_bp.toLocaleString()}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{r.end_bp.toLocaleString()}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{(r.end_bp - r.start_bp).toLocaleString()}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{r.score.toFixed(3)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {r.type_score == null ? "—" : r.type_score.toFixed(3)}
              </td>
              <td className="px-3 py-2.5"><MibigCell hits={r.mibig_hits ?? null} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
