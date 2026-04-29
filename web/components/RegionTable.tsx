type Region = { contig: string; start_bp: number; end_bp: number; score: number };

export function RegionTable({ regions }: { regions: Region[] }) {
  if (regions.length === 0) {
    return <p className="text-sm text-slate-500">No regions called above threshold.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th className="py-2 pr-4">#</th>
          <th className="py-2 pr-4">Contig</th>
          <th className="py-2 pr-4 text-right">Start</th>
          <th className="py-2 pr-4 text-right">End</th>
          <th className="py-2 pr-4 text-right">Length</th>
          <th className="py-2 pr-4 text-right">Score</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {regions.map((r, i) => (
          <tr key={i}>
            <td className="py-2 pr-4 text-slate-500">{i + 1}</td>
            <td className="py-2 pr-4 font-mono text-xs">{r.contig}</td>
            <td className="py-2 pr-4 text-right tabular-nums">{r.start_bp.toLocaleString()}</td>
            <td className="py-2 pr-4 text-right tabular-nums">{r.end_bp.toLocaleString()}</td>
            <td className="py-2 pr-4 text-right tabular-nums">{(r.end_bp - r.start_bp).toLocaleString()}</td>
            <td className="py-2 pr-4 text-right tabular-nums">{r.score.toFixed(3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
