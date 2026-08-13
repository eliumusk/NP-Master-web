"use client";

import { useI18n } from "@/lib/i18n/client";
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
  const { t, locale } = useI18n();
  const safeRate = job.n_regions > 0 ? Math.round((job.n_safe / job.n_regions) * 100) : 0;

  return (
    <section className="space-y-4">
      {/* KPI instrument strip */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-white/[0.06] bg-white/[0.05] lg:grid-cols-4">
        <Metric label={t.workspace.kpiGenomes} value={job.n_genomes} />
        <Metric label={t.workspace.kpiRegions} value={job.n_regions} />
        <Metric label={t.workspace.kpiSafe} value={job.n_safe} detail={`${safeRate}% ${t.workspace.passRate}`} accent />
        <Metric label={t.workspace.kpiCds} value={`${countCds(regions)} / ${countDomains(regions)}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <TypeStacked
          title={t.workspace.typeDist}
          noData={t.workspace.noData}
          items={typeCounts(regions).map((item) => ({
            ...item,
            className: bgcTypeMeta(item.key).barClassName,
            label: bgcTypeMeta(item.key).label,
          }))}
        />
        <Distribution
          title={t.workspace.tierDist}
          noData={t.workspace.noData}
          items={tierCounts(regions).map((item) => ({
            ...item,
            className: tierDotClass(item.key),
            label: tierLabel(item.key, locale),
          }))}
        />
        <GenomeCards
          title={t.workspace.genomePanel}
          regionSuffix={t.workspace.regionSuffix}
          genomes={genomes}
          counts={genomeCounts(regions)}
        />
      </div>
    </section>
  );
}

function Metric({ label, value, detail, accent }: { label: string; value: string | number; detail?: string; accent?: boolean }) {
  return (
    <div className="bg-surface px-5 py-4">
      <div className="text-[11px] uppercase tracking-wider text-fg-subtle">{label}</div>
      <div className={`numeric-display mt-2 text-[28px] font-medium leading-none tracking-tight ${accent ? "text-brand" : ""}`}>
        {value}
      </div>
      {detail && <div className="mt-1.5 text-[11px] text-fg-muted">{detail}</div>}
    </div>
  );
}

function TypeStacked({
  title,
  noData,
  items,
}: {
  title: string;
  noData: string;
  items: Array<{ key: string; label: string; count: number; className: string }>;
}) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return (
    <div className="panel p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {total === 0 ? (
        <div className="mt-4 text-sm text-fg-muted">{noData}</div>
      ) : (
        <>
          <div className="mt-4 flex h-4 gap-[2px] overflow-hidden rounded-pill bg-elevated/60">
            {items.map((item) => (
              <div
                key={item.key}
                className={`h-full ${item.className}`}
                style={{ width: `${(item.count / total) * 100}%` }}
                title={`${item.label} · ${item.count}`}
              />
            ))}
          </div>
          <div className="mt-3 space-y-1.5">
            {items.map((item) => (
              <div key={item.key} className="flex items-center gap-2 text-xs">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${item.className}`} />
                <span className="truncate text-fg-muted">{item.label}</span>
                <span className="numeric-display ml-auto shrink-0 text-fg">
                  {item.count}
                  <span className="text-fg-subtle"> · {Math.round((item.count / total) * 100)}%</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Distribution({
  title,
  noData,
  items,
}: {
  title: string;
  noData: string;
  items: Array<{ key: string; label: string; count: number; className: string }>;
}) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <div className="panel p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <div className="text-sm text-fg-muted">{noData}</div>
        ) : items.map((item) => (
          <div key={item.key} className="grid grid-cols-[7rem,1fr,3rem] items-center gap-2 text-xs">
            <div className="truncate text-fg-muted">{item.label}</div>
            <div className="h-2 overflow-hidden rounded-pill bg-elevated/60">
              <div className={`h-full rounded-pill ${item.className}`} style={{ width: `${(item.count / max) * 100}%` }} />
            </div>
            <div className="numeric-display text-right text-fg">{item.count}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GenomeCards({
  title,
  regionSuffix,
  genomes,
  counts,
}: {
  title: string;
  regionSuffix: string;
  genomes: GenomeSummary[];
  counts: Array<{ key: string; count: number }>;
}) {
  const countByGenome = new Map(counts.map((item) => [item.key, item.count]));
  return (
    <div className="panel p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-3 max-h-44 space-y-1.5 overflow-y-auto pr-1">
        {genomes.map((genome) => (
          <div key={genome.id} className="rounded-btn border border-white/[0.05] bg-white/[0.02] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-xs">{genome.genome_name}</span>
              <span className="numeric-display shrink-0 rounded-pill bg-brand-soft px-2 py-0.5 text-[11px] text-brand">
                {countByGenome.get(genome.genome_name) ?? genome.n_regions} {regionSuffix}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-fg-subtle">{formatBytes(genome.fasta_bytes)}</div>
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
  if (style.includes("emerald")) return "bg-emerald-400";
  if (style.includes("sky")) return "bg-sky-400";
  if (style.includes("amber")) return "bg-amber-400";
  if (style.includes("rose")) return "bg-rose-400";
  return "bg-slate-400";
}
