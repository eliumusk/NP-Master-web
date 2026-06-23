import Link from "next/link";
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

export function JobsList({ jobs }: { jobs: Job[] }) {
  if (jobs.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-border bg-elevated/30 p-10 text-center">
        <p className="text-sm text-fg-muted">还没有任务。</p>
        <Link href="/submit" className="mt-2 inline-block text-sm font-medium text-brand">
          提交基因组
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-border">
      <table className="w-full text-sm">
        <thead className="bg-elevated/60 text-left text-xs text-fg-muted">
          <tr>
            <th className="px-4 py-3">状态</th>
            <th className="px-4 py-3">任务</th>
            <th className="px-4 py-3 text-right">基因组</th>
            <th className="px-4 py-3 text-right">区域</th>
            <th className="px-4 py-3 text-right">通过</th>
            <th className="px-4 py-3">创建时间</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {jobs.map((job) => (
            <tr key={job.id} className="hover:bg-elevated/40">
              <td className="px-4 py-3"><JobStatusBadge status={job.status} /></td>
              <td className="px-4 py-3">
                <Link href={`/jobs/${job.id}`} className="font-medium text-brand hover:underline">
                  {job.title || job.id.slice(0, 8)}
                </Link>
                <div className="mt-0.5 font-mono text-xs text-fg-subtle">{job.id.slice(0, 8)}</div>
                {job.error && <div className="mt-1 text-xs text-red-600">{job.error.slice(0, 100)}</div>}
              </td>
              <td className="numeric-display px-4 py-3 text-right">{job.n_genomes}</td>
              <td className="numeric-display px-4 py-3 text-right">{job.n_regions}</td>
              <td className="numeric-display px-4 py-3 text-right">{job.n_safe}</td>
              <td className="px-4 py-3 text-xs text-fg-muted">{new Date(job.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
