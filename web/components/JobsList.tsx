import Link from "next/link";
import type { Dictionary } from "@/lib/i18n";
import { JobStatusBadge } from "./JobStatusBadge";

type Job = {
  id: string;
  title: string;
  status: string;
  n_genomes: number;
  n_regions: number;
  n_safe: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  log_tail: string | null;
};

export function JobsList({
  jobs,
  t,
  statusLabels,
}: {
  jobs: Job[];
  t: Dictionary["jobs"];
  statusLabels: Dictionary["status"];
}) {
  if (jobs.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-white/[0.1] bg-white/[0.02] p-12 text-center">
        <p className="text-sm text-fg-muted">{t.emptyTitle}</p>
        <Link href="/submit" className="mt-2 inline-block text-sm font-medium text-brand hover:underline">
          {t.emptyCta}
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-white/[0.06]">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-white/[0.06] bg-white/[0.02] text-left text-[11px] uppercase tracking-wider text-fg-subtle">
            <th className="px-4 py-3 font-medium">{t.colStatus}</th>
            <th className="px-4 py-3 font-medium">{t.colJob}</th>
            <th className="px-4 py-3 text-right font-medium">{t.colGenomes}</th>
            <th className="px-4 py-3 text-right font-medium">{t.colRegions}</th>
            <th className="px-4 py-3 text-right font-medium">{t.colSafe}</th>
            <th className="px-4 py-3 font-medium">{t.colCreated}</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id} className="border-b border-white/[0.04] transition last:border-0 hover:bg-white/[0.03]">
              <td className="px-4 py-3.5"><JobStatusBadge status={job.status} labels={statusLabels} /></td>
              <td className="px-4 py-3.5">
                <Link href={`/jobs/${job.id}`} className="font-medium text-fg transition hover:text-brand">
                  {job.title || job.id.slice(0, 8)}
                </Link>
                <div className="mt-0.5 font-mono text-[11px] text-fg-subtle">#{job.id.slice(0, 8)}</div>
                {job.error && <div className="mt-1 text-xs text-rose-300">{job.error.slice(0, 100)}</div>}
              </td>
              <td className="numeric-display px-4 py-3.5 text-right text-fg-muted">{job.n_genomes}</td>
              <td className="numeric-display px-4 py-3.5 text-right text-fg-muted">{job.n_regions}</td>
              <td className="numeric-display px-4 py-3.5 text-right">
                <span className={job.n_safe > 0 ? "text-brand" : "text-fg-muted"}>{job.n_safe}</span>
              </td>
              <td className="px-4 py-3.5 text-xs text-fg-subtle">{new Date(job.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
