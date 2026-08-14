import Link from "next/link";
import type { Dictionary, Locale } from "@/lib/i18n";
import { formatDateTime } from "@/features/jobs/format";
import { JobStatusBadge } from "./JobStatusBadge";

type Job = {
  id: string;
  title: string;
  status: string;
  n_genomes: number;
  n_regions: number;
  n_safe: number;
  created_at: string;
  error: string | null;
};

export function JobsList({
  jobs,
  t,
  statusLabels,
  locale,
}: {
  jobs: Job[];
  t: Dictionary["jobs"];
  statusLabels: Dictionary["status"];
  locale: Locale;
}) {
  if (jobs.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-white/[0.08] bg-white/[0.02] p-12 text-center">
        <svg
          className="mx-auto h-6 w-6 text-fg-subtle"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
        </svg>
        <p className="mt-3 text-small text-fg-muted">{t.emptyTitle}</p>
        <Link href="/submit" className="btn-primary mt-4 inline-block rounded-btn px-3 py-1.5 text-small">
          {t.emptyCta}
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border border-white/[0.08]">
      <table className="w-full min-w-[640px] text-small">
        <thead>
          <tr
            className={`border-b border-white/[0.06] bg-white/[0.02] text-left text-micro text-fg-subtle ${
              locale === "en" ? "uppercase tracking-wider" : ""
            }`}
          >
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
            <tr
              key={job.id}
              className="relative border-b border-white/[0.06] transition-colors duration-150 last:border-0 hover:bg-white/[0.03]"
            >
              <td className="px-4 py-3.5"><JobStatusBadge status={job.status} labels={statusLabels} /></td>
              <td className="px-4 py-3.5">
                <Link href={`/jobs/${job.id}`} className="font-medium text-fg before:absolute before:inset-0">
                  {job.title || job.id.slice(0, 8)}
                </Link>
                {job.title && (
                  <div className="mt-0.5 font-mono text-caption text-fg-subtle">{job.id.slice(0, 8)}</div>
                )}
                {job.error && (
                  <div className="mt-1 max-w-[280px] truncate text-caption text-danger" title={job.error}>
                    {job.error}
                  </div>
                )}
              </td>
              <td className="numeric-display px-4 py-3.5 text-right text-fg-muted">{job.n_genomes}</td>
              <td className="numeric-display px-4 py-3.5 text-right text-fg-muted">{job.n_regions}</td>
              <td className="numeric-display px-4 py-3.5 text-right">
                <span className={job.n_safe > 0 ? "text-brand" : "text-fg-muted"}>{job.n_safe}</span>
              </td>
              <td className="numeric-display whitespace-nowrap px-4 py-3.5 text-caption text-fg-subtle">
                {formatDateTime(job.created_at, locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
