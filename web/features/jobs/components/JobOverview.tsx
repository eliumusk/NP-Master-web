"use client";

import { useI18n } from "@/lib/i18n/client";
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

  return (
    <section className="space-y-3">
      <div className="panel flex flex-wrap items-stretch gap-4 p-5">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-y-4 sm:grid-cols-4">
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

      {genomes.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {genomes.map((genome) => (
            <span
              key={genome.id}
              className="inline-flex items-center gap-1.5 rounded-pill border border-white/[0.06] bg-white/[0.02] px-2.5 py-1 text-[11px] text-fg-muted"
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

function Metric({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-fg-subtle">{label}</div>
      <div className={`numeric-display mt-1.5 text-[26px] font-medium leading-none tracking-tight ${accent ? "text-brand" : ""}`}>
        {value}
      </div>
    </div>
  );
}
