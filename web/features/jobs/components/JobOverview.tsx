import { bgcTypeMeta, tierClassName, tierLabel } from "../constants";
import { formatBytes } from "../format";
import { genomeCounts, tierCounts, typeCounts } from "../stats";
import type { GenomeSummary, JobSummary, Region } from "../types";

export function JobOverview({
  job,
  genomes,
  regions,
}: {
  job: JobSummary;
  genomes: GenomeSummary[];
  regions: Region[];
}) {
  const safeRate = job.n_regions > 0 ? Math.round((job.n_safe / job.n_regions) * 100) : 0;

  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="基因组" value={job.n_genomes} />
        <Metric label="候选区域" value={job.n_regions} />
        <Metric label="安全通过" value={job.n_safe} detail={`${safeRate}% pass`} />
        <Metric label="CDS/Pfam" value={`${countCds(regions)} / ${countDomains(regions)}`} detail="CDS / domains" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Distribution title="类型分布" items={typeCounts(regions).map((item) => ({
          ...item,
          className: bgcTypeMeta(item.key).barClassName,
          label: bgcTypeMeta(item.key).label,
        }))} />
        <Distribution title="安全等级" items={tierCounts(regions).map((item) => ({
          ...item,
          className: tierDotClass(item.key),
          label: tierLabel(item.key),
        }))} />
        <GenomeCards genomes={genomes} counts={genomeCounts(regions)} />
      </div>
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="numeric-display mt-2 text-2xl font-semibold">{value}</div>
      {detail && <div className="mt-1 text-xs text-fg-muted">{detail}</div>}
    </div>
  );
}

function Distribution({
  title,
  items,
}: {
  title: string;
  items: Array<{ key: string; label: string; count: number; className: string }>;
}) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <div className="text-sm text-fg-muted">暂无数据</div>
        ) : items.map((item) => (
          <div key={item.key} className="grid grid-cols-[7rem,1fr,3rem] items-center gap-2 text-xs">
            <div className="truncate text-fg-muted">{item.label}</div>
            <div className="h-2 overflow-hidden rounded-pill bg-elevated">
              <div className={`h-full rounded-pill ${item.className}`} style={{ width: `${(item.count / max) * 100}%` }} />
            </div>
            <div className="numeric-display text-right">{item.count}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GenomeCards({ genomes, counts }: { genomes: GenomeSummary[]; counts: Array<{ key: string; count: number }> }) {
  const countByGenome = new Map(counts.map((item) => [item.key, item.count]));
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold">基因组</h2>
      <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
        {genomes.map((genome) => (
          <div key={genome.id} className="rounded-btn border border-border bg-elevated/30 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-xs">{genome.genome_name}</span>
              <span className="numeric-display text-xs">{countByGenome.get(genome.genome_name) ?? genome.n_regions}</span>
            </div>
            <div className="mt-1 text-xs text-fg-muted">{formatBytes(genome.fasta_bytes)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function countCds(regions: Region[]) {
  return regions.reduce((sum, region) => sum + (region.cds_features?.length ?? 0), 0);
}

function countDomains(regions: Region[]) {
  return regions.reduce(
    (sum, region) => sum + (region.cds_features ?? []).reduce((inner, cds) => inner + (cds.pfam_domains?.length ?? 0), 0),
    0,
  );
}

function tierDotClass(tier: string) {
  const style = tierClassName(tier);
  if (style.includes("emerald")) return "bg-emerald-500";
  if (style.includes("blue")) return "bg-blue-500";
  if (style.includes("amber")) return "bg-amber-500";
  if (style.includes("rose")) return "bg-rose-500";
  return "bg-slate-500";
}
