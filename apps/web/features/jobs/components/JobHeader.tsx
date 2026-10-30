"use client";

import { JobStatusBadge } from "@/components/JobStatusBadge";
import { useI18n } from "@/lib/i18n/client";
import { formatDateTime, formatDuration } from "../format";
import type { JobSummary } from "../types";
import { JobTimeline } from "./JobTimeline";

export function JobHeader({ job }: { job: JobSummary }) {
  const { t } = useI18n();

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="min-w-0 text-2xl font-semibold tracking-tight">{job.title}</h1>
        <JobStatusBadge status={job.status} labels={t.status} />
        <span className="font-mono text-xs text-fg-subtle">{job.id.slice(0, 8)}</span>
      </div>

      <div className="panel px-5 py-4">
        <JobTimeline job={job} />
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-white/[0.06] bg-white/[0.05] sm:grid-cols-4">
        <Meta label={t.workspace.created} value={formatDateTime(job.created_at)} />
        <Meta label={t.workspace.started} value={formatDateTime(job.started_at)} />
        <Meta label={t.workspace.finished} value={formatDateTime(job.finished_at)} />
        <Meta label={t.workspace.duration} value={formatDuration(job.started_at, job.finished_at)} />
        <Meta label={t.workspace.threshold} value={`${job.threshold.toFixed(2)} / ${job.extend_threshold.toFixed(2)}`} />
        <Meta label={t.workspace.windows} value={`${job.min_support_windows}`} />
        <Meta label={t.workspace.minLen} value={`${job.min_len_bp.toLocaleString()} bp`} />
        <Meta label={t.workspace.flank} value={`${job.extend_flank_bp.toLocaleString()} bp`} />
      </div>

      {job.error && (
        <div className="rounded-card border border-danger/30 bg-danger/10 p-4">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs text-danger">{job.error}</pre>
        </div>
      )}

      {job.log_tail && (
        <details className="panel group p-4">
          <summary className="cursor-pointer select-none text-xs font-medium text-fg-muted transition-colors duration-150 hover:text-fg">
            {t.workspace.runLog}
            <svg
              className="ml-2 inline-block h-3.5 w-3.5 text-fg-subtle transition-transform duration-150 group-open:rotate-90"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7 5l5 5-5 5" />
            </svg>
          </summary>
          <pre className="mt-3 whitespace-pre-wrap font-mono text-xs leading-5 text-fg-muted">{job.log_tail}</pre>
        </details>
      )}
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-3">
      <div className="text-micro text-fg-subtle">{label}</div>
      <div className="numeric-display mt-1 truncate text-small font-medium text-fg">{value}</div>
    </div>
  );
}
