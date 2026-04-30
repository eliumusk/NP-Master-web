"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { JobStatusBadge } from "./JobStatusBadge";
import { RegionTable } from "./RegionTable";
import { IgvBrowser } from "./IgvBrowser";
import { CopyButton } from "./CopyButton";

type Job = {
  id: string;
  status: string;
  fasta_sha256: string;
  fasta_bytes: number;
  threshold: number;
  min_len_bp: number;
  log_tail: string | null;
  error: string | null;
  result_csv_path: string | null;
  result_bed_path: string | null;
  result_fai_path: string | null;
  result_fasta_path: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type Region = {
  contig: string; start_bp: number; end_bp: number; score: number;
  bgc_type?: string | null; type_score?: number | null;
  mibig_hits?: { bgc_id: string; identity: number; product?: string }[] | null;
};

export function JobDetail({
  initialJob, initialRegions, isExample = false,
}: { initialJob: Job; initialRegions: Region[]; isExample?: boolean }) {
  const [job, setJob] = useState<Job>(initialJob);
  const [regions, setRegions] = useState<Region[]>(initialRegions);
  const [urls, setUrls] = useState<{ fasta?: string; fai?: string; bed?: string; csv?: string; gbk?: string; wig?: string }>({});

  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel(`job:${job.id}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${job.id}` },
        (payload) => setJob(payload.new as Job))
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "regions", filter: `job_id=eq.${job.id}` },
        (payload) => setRegions((rs) => [...rs, payload.new as Region]))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [job.id]);

  useEffect(() => {
    if (job.status !== "done") return;
    if (urls.bed) return;
    (async () => {
      const required = ["fasta", "fai", "bed", "csv"] as const;
      const optional = ["gbk", "wig"] as const;
      const out: Record<string, string> = {};
      for (const k of required) {
        const r = await fetch(`/api/jobs/${job.id}/signed-url?kind=${k}`);
        if (!r.ok) return;
        const j = await r.json();
        out[k] = j.url as string;
      }
      for (const k of optional) {
        try {
          const r = await fetch(`/api/jobs/${job.id}/signed-url?kind=${k}`);
          if (r.ok) out[k] = (await r.json()).url as string;
        } catch { /* optional */ }
      }
      setUrls(out);
    })().catch((e) => console.error(e));
  }, [job.status, job.id, urls.bed]);

  const typeStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of regions) {
      const t = r.bgc_type ?? "Other";
      counts[t] = (counts[t] ?? 0) + 1;
    }
    return Object.entries(counts).sort(([, a], [, b]) => b - a);
  }, [regions]);

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            任务 <span className="font-mono text-base text-slate-500">{job.id.slice(0, 8)}</span>
            <CopyButton value={job.id} label="完整 ID" />
          </h1>
          <JobStatusBadge status={job.status} />
          {isExample && (
            <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
              示例
            </span>
          )}
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <KV k="阈值" v={job.threshold.toFixed(2)} />
          <KV k="最小长度" v={`${(job.min_len_bp / 1000).toFixed(1)} kb`} />
          <KV k="文件大小" v={`${(job.fasta_bytes / 1024 / 1024).toFixed(1)} MB`} />
          <KV k="提交时间" v={new Date(job.created_at).toLocaleString("zh-CN")} />
        </dl>
      </div>

      {job.error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          <div className="font-medium">任务失败</div>
          <pre className="mt-2 whitespace-pre-wrap text-xs">{job.error}</pre>
          {job.log_tail && <pre className="mt-2 whitespace-pre-wrap text-xs opacity-80">{job.log_tail}</pre>}
        </div>
      )}

      {(job.status === "queued" || job.status === "running") && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
          <div className="flex items-center gap-2 font-medium">
            <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-current" />
            {job.status === "queued" ? "排队中" : "运行中"}
          </div>
          {job.log_tail && <pre className="mt-2 whitespace-pre-wrap text-xs">{job.log_tail}</pre>}
          <p className="mt-2 text-xs opacity-80">
            首次冷启动约 4-5 分钟（Evo2 加载 + 16 卡并行特征提取 + LR 分类）。
            若同一基因组重复提交，缓存命中后约 30 秒。
          </p>
        </div>
      )}

      {job.status === "done" && (
        <>
          {/* Type distribution summary */}
          {typeStats.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                共检出 {regions.length} 个区域，类型分布：
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {typeStats.map(([t, n]) => (
                  <TypePill key={t} type={t} count={n} />
                ))}
              </div>
            </div>
          )}

          {/* Downloads */}
          <div className="flex flex-wrap gap-2">
            {urls.csv && <DownloadBtn href={urls.csv} label="下载 CSV" />}
            {urls.bed && <DownloadBtn href={urls.bed} label="下载 BED" />}
            {urls.gbk && <DownloadBtn href={urls.gbk} label="下载 GenBank" />}
            {urls.fasta && <DownloadBtn href={urls.fasta} label="下载 FASTA" />}
            {urls.wig && <DownloadBtn href={urls.wig} label="下载 Score Track" />}
          </div>

          {/* Regions table */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">区域列表</h2>
            <RegionTable regions={regions} />
          </section>

          {/* IGV viewer */}
          {urls.fasta && urls.fai && urls.bed && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">IGV 浏览器</h2>
              <p className="text-xs text-slate-500">
                自动定位到第一个 BGC 区域。可直接在轨道上拖动、缩放，或在顶部坐标框输入位置（例：<code className="rounded bg-slate-100 px-1 dark:bg-slate-800">contig:start-end</code>）。
              </p>
              <div className="block sm:hidden rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                IGV 浏览器在大屏上效果最佳。手机上可查看下载文件 + 区域表格。
              </div>
              <div className="hidden sm:block">
                <IgvBrowser fastaUrl={urls.fasta} faiUrl={urls.fai} bedUrl={urls.bed} wigUrl={urls.wig} />
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
      <dt className="text-xs uppercase tracking-wider text-slate-500">{k}</dt>
      <dd className="mt-1 text-sm tabular-nums">{v}</dd>
    </div>
  );
}

function DownloadBtn({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      download
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 3a.75.75 0 01.75.75V11.5l2.7-2.7a.75.75 0 011.06 1.06l-4 4a.75.75 0 01-1.06 0l-4-4a.75.75 0 011.06-1.06l2.7 2.7V3.75A.75.75 0 0110 3z"/><path d="M3.5 13.75A.75.75 0 014.25 13h11.5a.75.75 0 010 1.5H4.25a.75.75 0 01-.75-.75z"/></svg>
      {label}
    </a>
  );
}

const TYPE_COLOR: Record<string, string> = {
  Alkaloid:   "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200",
  Terpene:    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  NRP:        "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200",
  Polyketide: "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200",
  RiPP:       "bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-200",
  Saccharide: "bg-pink-100 text-pink-800 dark:bg-pink-950/60 dark:text-pink-200",
  Other:      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

function TypePill({ type, count }: { type: string; count: number }) {
  const cls = TYPE_COLOR[type] ?? TYPE_COLOR.Other;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
      <span>{type}</span>
      <span className="text-[10px] opacity-70">×{count}</span>
    </span>
  );
}
