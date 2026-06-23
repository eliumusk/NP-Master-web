import { JobStatusBadge } from "@/components/JobStatusBadge";
import { formatDateTime, formatDuration } from "../format";
import type { JobSummary } from "../types";

export function JobHeader({ job }: { job: JobSummary }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 text-2xl font-semibold">{job.title}</h1>
        <JobStatusBadge status={job.status} />
      </div>

      <div className="grid gap-3 rounded-card border border-border bg-elevated/30 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Meta label="创建" value={formatDateTime(job.created_at)} />
        <Meta label="开始" value={formatDateTime(job.started_at)} />
        <Meta label="完成" value={formatDateTime(job.finished_at)} />
        <Meta label="运行时长" value={formatDuration(job.started_at, job.finished_at)} />
        <Meta label="ALT_OP" value={`${job.threshold.toFixed(2)} / ${job.extend_threshold.toFixed(2)} / ${job.min_support_windows} 窗口`} />
        <Meta label="最小区域" value={`${job.min_len_bp.toLocaleString()} bp`} />
        <Meta label="扩展 flank" value={`${job.extend_flank_bp.toLocaleString()} bp`} />
        <Meta label="最低安全等级" value={job.safe_tier_min} />
      </div>

      {(job.log_tail || job.error) && (
        <div className="rounded-card border border-border bg-surface p-4">
          {job.log_tail && <pre className="whitespace-pre-wrap text-xs text-fg-muted">{job.log_tail}</pre>}
          {job.error && <pre className="mt-3 whitespace-pre-wrap text-xs text-red-600">{job.error}</pre>}
        </div>
      )}
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="numeric-display mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  );
}
