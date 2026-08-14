"use client";

import { useI18n } from "@/lib/i18n/client";
import { bgcTypeMeta } from "../constants";
import type { GenomeSummary, JobSummary, Region } from "../types";

export function JobOverview({
  job,
  genomes,
  regions,
  summaryUrl,
}: {
  job: JobSummary;
  genomes: GenomeSummary[];
  regions: Region[];
  summaryUrl: string | null;
}) {
  const { t } = useI18n();

  const typeCount = new Set(regions.map((r) => r.bgc_type || "Other")).size;
  const contigCount = new Set(regions.map((r) => `${r.genome_name}|${r.contig}`)).size;
  const typeSegments = typeDistribution(regions);

  return (
    <section className="space-y-3">
      <div className="panel p-5">
        <div className="flex flex-wrap items-stretch gap-4">
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-y-4 sm:grid-cols-4 sm:divide-x sm:divide-white/[0.06]">
            <Metric label={t.workspace.totalRegions} value={job.n_regions} />
            <Metric label={t.workspace.highConf} value={job.n_safe} accent />
            <Metric label={t.workspace.typeCount} value={typeCount} />
            <Metric label={t.workspace.contigCount} value={contigCount} />
          </div>
          {summaryUrl && (
            <div className="flex items-center">
              <a href={summaryUrl} className="btn-primary rounded-btn px-4 py-2 text-sm font-semibold">
                {t.workspace.downloadSummary}
              </a>
            </div>
          )}
        </div>

        {typeSegments.length > 0 && (
          <div className="mt-4">
            <div className="flex h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
              {typeSegments.map(({ type, count }) => (
                <span
                  key={type}
                  className={bgcTypeMeta(type).barClassName}
                  style={{ width: `${(count / regions.length) * 100}%` }}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-micro text-fg-subtle">
              {typeSegments.map(({ type, count }) => (
                <span key={type} className="inline-flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${bgcTypeMeta(type).barClassName}`} />
                  {bgcTypeMeta(type).label}
                  <span className="numeric-display">{count}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {genomes.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {genomes.map((genome) => (
            <span
              key={genome.id}
              className="inline-flex items-center gap-1.5 rounded-pill border border-white/[0.06] bg-white/[0.02] px-2.5 py-1 text-micro text-fg-muted"
            >
              <span className="font-mono">{genome.genome_name}</span>
              <span className="numeric-display text-fg-subtle">{genome.n_regions}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function typeDistribution(regions: Region[]) {
  const counts = new Map<string, number>();
  for (const region of regions) {
    const type = region.bgc_type || "Other";
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return Array.from(counts, ([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

function Metric({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="min-w-0 sm:pl-5 first:pl-0">
      <div className="text-caption text-fg-muted">{label}</div>
      <div className={`numeric-display mt-1.5 text-kpi font-semibold ${accent ? "text-brand" : ""}`}>
        {value}
      </div>
    </div>
  );
}
