type Region = {
  contig: string;
  start_bp: number;
  end_bp: number;
  score: number;
  bgc_type?: string | null;
  type_score?: number | null;
};

const TYPE_COLOR: Record<string, string> = {
  Alkaloid:   "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  Terpene:    "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  NRP:        "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  Polyketide: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
  RiPP:       "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  Saccharide: "bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-200",
  Other:      "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
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

export function RegionTable({ regions }: { regions: Region[] }) {
  if (regions.length === 0) {
    return <p className="text-sm text-slate-500">No regions called above threshold.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th className="py-2 pr-4">#</th>
          <th className="py-2 pr-4">Type</th>
          <th className="py-2 pr-4">Contig</th>
          <th className="py-2 pr-4 text-right">Start</th>
          <th className="py-2 pr-4 text-right">End</th>
          <th className="py-2 pr-4 text-right">Length</th>
          <th className="py-2 pr-4 text-right">Score</th>
          <th className="py-2 pr-4 text-right">Type score</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {regions.map((r, i) => (
          <tr key={i}>
            <td className="py-2 pr-4 text-slate-500">{i + 1}</td>
            <td className="py-2 pr-4"><TypeBadge type={r.bgc_type} /></td>
            <td className="py-2 pr-4 font-mono text-xs">{r.contig}</td>
            <td className="py-2 pr-4 text-right tabular-nums">{r.start_bp.toLocaleString()}</td>
            <td className="py-2 pr-4 text-right tabular-nums">{r.end_bp.toLocaleString()}</td>
            <td className="py-2 pr-4 text-right tabular-nums">{(r.end_bp - r.start_bp).toLocaleString()}</td>
            <td className="py-2 pr-4 text-right tabular-nums">{r.score.toFixed(3)}</td>
            <td className="py-2 pr-4 text-right tabular-nums">
              {r.type_score == null ? "—" : r.type_score.toFixed(3)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
