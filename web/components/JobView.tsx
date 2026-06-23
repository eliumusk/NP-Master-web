"use client";

import { useEffect, useMemo, useState } from "react";
import { JobStatusBadge } from "./JobStatusBadge";
import type { SignedJobArtifact } from "@/lib/job-artifacts";

type Job = {
  id: string;
  title: string;
  status: string;
  error: string | null;
  log_tail: string | null;
  n_genomes: number;
  n_regions: number;
  n_safe: number;
  threshold: number;
  extend_threshold: number;
  min_support_windows: number;
  min_len_bp: number;
  safe_tier_min: string;
  extend_flank_bp: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type Genome = {
  id: string;
  genome_name: string;
  original_name: string;
  fasta_bytes: number;
  status: string;
  error: string | null;
  n_regions: number;
  n_safe: number;
};

type Region = {
  id: number;
  genome_name: string;
  contig: string;
  start_bp: number;
  end_bp: number;
  ext_start_bp: number | null;
  ext_end_bp: number | null;
  score: number;
  bgc_type: string | null;
  type_score: number | null;
  safe_tier: string | null;
  safe_pass: boolean;
  safe_type_label: string | null;
  mibig_hits: Array<{ bgc_id?: string; identity?: number; product?: string }> | null;
};

export function JobView({
  initialJob, initialGenomes, initialRegions, initialArtifacts, clientIdOverride,
}: {
  initialJob: Job;
  initialGenomes: Genome[];
  initialRegions: Region[];
  initialArtifacts: SignedJobArtifact[];
  clientIdOverride?: string;
}) {
  const [job, setJob] = useState(initialJob);
  const [genomes, setGenomes] = useState(initialGenomes);
  const [regions, setRegions] = useState(initialRegions);
  const [artifacts, setArtifacts] = useState(initialArtifacts);
  const [safeOnly, setSafeOnly] = useState(true);

  useEffect(() => {
    if (["done", "failed", "canceled"].includes(job.status)) return;
    const query = clientIdOverride ? `?client_id=${encodeURIComponent(clientIdOverride)}` : "";
    const timer = setInterval(async () => {
      const [summaryRes, regionsRes] = await Promise.all([
        fetch(`/api/jobs/${job.id}${query}`),
        fetch(`/api/jobs/${job.id}/regions${query}`),
      ]);
      if (summaryRes.ok) {
        const next = await summaryRes.json();
        setJob(next.job);
        setGenomes(next.genomes);
        setArtifacts(next.artifacts ?? []);
      }
      if (regionsRes.ok) {
        const next = await regionsRes.json();
        setRegions(next.regions);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [clientIdOverride, job.id, job.status]);

  const shownRegions = useMemo(
    () => safeOnly ? regions.filter((r) => r.safe_pass) : regions,
    [regions, safeOnly],
  );

  const tierCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of regions) {
      const tier = r.safe_tier ?? "未分级";
      counts[tier] = (counts[tier] ?? 0) + 1;
    }
    return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  }, [regions]);

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{job.title}</h1>
          <JobStatusBadge status={job.status} />
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Metric label="基因组" value={job.n_genomes} />
          <Metric label="候选区域" value={job.n_regions} />
          <Metric label="安全通过" value={job.n_safe} />
          <Metric label="提交日期" value={new Date(job.created_at).toLocaleDateString()} />
        </div>
        <div className="rounded-card border border-border bg-elevated/30 p-4 text-sm">
          <div className="grid gap-2 sm:grid-cols-3">
            <span>ALT_OP：{job.threshold.toFixed(2)} / {job.extend_threshold.toFixed(2)} / {job.min_support_windows} 个窗口</span>
            <span>最小长度：{job.min_len_bp.toLocaleString()} bp</span>
            <span>最低安全等级：{job.safe_tier_min}</span>
          </div>
          {job.log_tail && <pre className="mt-3 whitespace-pre-wrap text-xs text-fg-muted">{job.log_tail}</pre>}
          {job.error && <pre className="mt-3 whitespace-pre-wrap text-xs text-red-600">{job.error}</pre>}
        </div>
      </section>

      {artifacts.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">结果下载</h2>
            <p className="mt-1 text-sm text-fg-muted">下载链接一小时内有效，过期后刷新页面即可重新生成。</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {artifacts.map((artifact) => (
              <a
                key={`${artifact.kind}-${artifact.storage_path}`}
                href={artifact.url}
                className="rounded-card border border-border bg-surface p-3 text-sm transition hover:border-brand hover:bg-brand-soft"
              >
                <span className="block font-medium">{artifact.label}</span>
                <span className="mt-1 block truncate text-xs text-fg-muted">{artifact.filename}</span>
                <span className="numeric-display mt-2 block text-xs text-fg-muted">{formatBytes(artifact.bytes)}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">基因组</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {genomes.map((g) => (
            <div key={g.id} className="rounded-card border border-border bg-surface p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm">{g.genome_name}</div>
                  <div className="mt-1 text-xs text-fg-muted">{(g.fasta_bytes / 1024 / 1024).toFixed(2)} MB</div>
                </div>
                <JobStatusBadge status={g.status} />
              </div>
              <div className="mt-3 flex gap-4 text-xs text-fg-muted">
                <span>{g.n_regions} 个区域</span>
                <span>{g.n_safe} 个通过</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">候选区域</h2>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-fg-muted">
              {tierCounts.map(([tier, count]) => <span key={tier}>{tier}: {count}</span>)}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={safeOnly} onChange={(e) => setSafeOnly(e.target.checked)} />
            仅显示安全通过
          </label>
        </div>
        <RegionsTable regions={shownRegions} />
      </section>
    </div>
  );
}

function formatBytes(bytes: number | null) {
  if (bytes == null) return "大小未知";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="numeric-display mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function RegionsTable({ regions }: { regions: Region[] }) {
  if (regions.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-border bg-elevated/30 p-8 text-center text-sm text-fg-muted">
        暂无可显示区域。
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full text-sm">
        <thead className="bg-elevated/60 text-left text-xs text-fg-muted">
          <tr>
            <th className="px-3 py-3">基因组</th>
            <th className="px-3 py-3">位置</th>
            <th className="px-3 py-3 text-right">长度</th>
            <th className="px-3 py-3 text-right">分数</th>
            <th className="px-3 py-3">类型</th>
            <th className="px-3 py-3">等级</th>
            <th className="px-3 py-3">MIBiG</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {regions.map((r) => {
            const topHit = r.mibig_hits?.[0];
            return (
              <tr key={r.id} className="hover:bg-elevated/40">
                <td className="px-3 py-3 font-mono text-xs">{r.genome_name}</td>
                <td className="px-3 py-3">
                  <div className="font-mono text-xs">{r.contig}</div>
                  <div className="numeric-display mt-0.5 text-xs text-fg-muted">
                    {r.start_bp.toLocaleString()}-{r.end_bp.toLocaleString()}
                  </div>
                </td>
                <td className="numeric-display px-3 py-3 text-right">{(r.end_bp - r.start_bp).toLocaleString()}</td>
                <td className="numeric-display px-3 py-3 text-right">{Number(r.score).toFixed(3)}</td>
                <td className="px-3 py-3">{r.bgc_type ?? "-"}</td>
                <td className="px-3 py-3">
                  <span className={r.safe_pass ? "text-emerald-600" : "text-fg-muted"}>
                    {r.safe_tier ?? "-"}
                  </span>
                </td>
                <td className="px-3 py-3 text-xs">
                  {topHit?.bgc_id ? (
                    <span>{topHit.bgc_id} {topHit.identity != null ? `(${Math.round(topHit.identity * 100)}%)` : ""}</span>
                  ) : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
