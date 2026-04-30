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
  result_gbk_path?: string | null;
  result_wig_path?: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type Region = {
  contig: string; start_bp: number; end_bp: number; score: number;
  bgc_type?: string | null; type_score?: number | null;
  mibig_hits?: { bgc_id: string; identity: number; product?: string }[] | null;
};

const TYPE_PILL: Record<string, string> = {
  Alkaloid:   "bg-bgc-alkaloid-soft   text-bgc-alkaloid-fg",
  Terpene:    "bg-bgc-terpene-soft    text-bgc-terpene-fg",
  NRP:        "bg-bgc-nrp-soft        text-bgc-nrp-fg",
  Polyketide: "bg-bgc-polyketide-soft text-bgc-polyketide-fg",
  RiPP:       "bg-bgc-ripp-soft       text-bgc-ripp-fg",
  Saccharide: "bg-bgc-saccharide-soft text-bgc-saccharide-fg",
  Other:      "bg-bgc-other-soft      text-bgc-other-fg",
};

export function JobDetail({
  initialJob, initialRegions, isExample = false,
}: { initialJob: Job; initialRegions: Region[]; isExample?: boolean }) {
  const [job, setJob] = useState<Job>(initialJob);
  const [regions, setRegions] = useState<Region[]>(initialRegions);
  const [urls, setUrls] = useState<{ fasta?: string; fai?: string; bed?: string; csv?: string; gbk?: string; wig?: string }>({});
  const [loadingUrls, setLoadingUrls] = useState(false);

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
    setLoadingUrls(true);
    (async () => {
      const required = ["fasta", "fai", "bed", "csv"] as const;
      const optional = ["gbk", "wig"] as const;
      const out: Record<string, string> = {};
      for (const k of required) {
        const r = await fetch(`/api/jobs/${job.id}/signed-url?kind=${k}`);
        if (!r.ok) { setLoadingUrls(false); return; }
        out[k] = (await r.json()).url as string;
      }
      for (const k of optional) {
        try {
          const r = await fetch(`/api/jobs/${job.id}/signed-url?kind=${k}`);
          if (r.ok) out[k] = (await r.json()).url as string;
        } catch { /* optional */ }
      }
      setUrls(out);
      setLoadingUrls(false);
    })().catch((e) => { console.error(e); setLoadingUrls(false); });
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
    <div className="grid gap-8 lg:grid-cols-[12rem_minmax(0,1fr)]">
      {/* Sticky aside (TOC) */}
      <aside className="hidden lg:block">
        <div className="sticky top-20 space-y-1 text-sm">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">本页</div>
          <TocLink href="#summary">任务信息</TocLink>
          <TocLink href="#types">类型分布</TocLink>
          <TocLink href="#downloads">下载</TocLink>
          <TocLink href="#regions">区域列表</TocLink>
          <TocLink href="#igv">IGV 浏览器</TocLink>
        </div>
      </aside>

      <div className="space-y-section min-w-0">
        {/* Summary */}
        <section id="summary" className="space-y-4 scroll-mt-20">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              任务 <span className="numeric-display text-base text-fg-muted">{job.id.slice(0, 8)}</span>
              <CopyButton value={job.id} label="完整 ID" />
            </h1>
            <JobStatusBadge status={job.status} />
            {isExample && (
              <span className="inline-flex items-center rounded-pill bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
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

          {job.error && (
            <div className="rounded-card border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
              <div className="font-medium">任务失败</div>
              <pre className="mt-2 whitespace-pre-wrap text-xs">{job.error}</pre>
              {job.log_tail && <pre className="mt-2 whitespace-pre-wrap text-xs opacity-80">{job.log_tail}</pre>}
            </div>
          )}

          {(job.status === "queued" || job.status === "running") && (
            <div className="rounded-card border border-bgc-nrp-soft bg-bgc-nrp-soft/40 p-4 text-sm text-bgc-nrp-fg">
              <div className="flex items-center gap-2 font-medium">
                <span className="pulse-dot inline-block h-2 w-2 rounded-pill bg-current" />
                {job.status === "queued" ? "排队中" : "运行中"}
              </div>
              {job.log_tail && <pre className="mt-2 whitespace-pre-wrap text-xs">{job.log_tail}</pre>}
              <p className="mt-2 text-xs opacity-80">
                首次冷启动约 4-5 分钟（Evo2 + 16 卡并行 + 分类）。同一基因组重复提交约 30 秒（缓存命中）。
              </p>
            </div>
          )}
        </section>

        {job.status === "done" && (
          <>
            {/* Type distribution */}
            <section id="types" className="space-y-3 scroll-mt-20">
              <h2 className="text-lg font-semibold">类型分布</h2>
              {typeStats.length === 0 ? (
                <SkeletonRow />
              ) : (
                <div className="rounded-card border border-border bg-elevated/40 p-4">
                  <div className="text-xs text-fg-muted">共 {regions.length} 个区域</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {typeStats.map(([t, n]) => (
                      <span
                        key={t}
                        className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium ${TYPE_PILL[t] ?? TYPE_PILL.Other}`}
                      >
                        <span>{t}</span>
                        <span className="numeric-display text-[10px] opacity-70">×{n}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* Downloads */}
            <section id="downloads" className="space-y-3 scroll-mt-20">
              <h2 className="text-lg font-semibold">下载</h2>
              {loadingUrls && !urls.bed ? (
                <div className="flex flex-wrap gap-2">
                  {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-8 w-28" />)}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {urls.csv && <DownloadBtn href={urls.csv} label="CSV (含 type / score)" />}
                  {urls.bed && <DownloadBtn href={urls.bed} label="BED (按类型上色)" />}
                  {urls.gbk && <DownloadBtn href={urls.gbk} label="GenBank (含 CDS)" />}
                  {urls.fasta && <DownloadBtn href={urls.fasta} label="原始 FASTA" />}
                  {urls.wig && <DownloadBtn href={urls.wig} label="Score Track (bedgraph)" />}
                </div>
              )}
            </section>

            {/* Regions */}
            <section id="regions" className="space-y-3 scroll-mt-20">
              <h2 className="text-lg font-semibold">区域列表</h2>
              <RegionTable regions={regions} />
            </section>

            {/* IGV */}
            {urls.fasta && urls.fai && urls.bed && (
              <section id="igv" className="space-y-3 scroll-mt-20">
                <h2 className="text-lg font-semibold">IGV 浏览器</h2>
                <p className="text-xs text-fg-muted">
                  自动定位到第一个 BGC 区域。可拖动、缩放，或在顶部坐标框输入位置（例：<code className="rounded bg-elevated px-1">contig:start-end</code>）。
                </p>
                <div className="block sm:hidden rounded-card border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  IGV 浏览器在桌面端效果最佳。手机上可查看下载文件 + 区域表格。
                </div>
                <div className="hidden sm:block">
                  <IgvBrowser fastaUrl={urls.fasta} faiUrl={urls.fai} bedUrl={urls.bed} wigUrl={urls.wig} />
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="block rounded-btn px-2 py-1 text-fg-muted transition-colors hover:bg-elevated hover:text-fg">
      {children}
    </a>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-card border border-border bg-surface p-3">
      <dt className="text-xs uppercase tracking-wider text-fg-muted">{k}</dt>
      <dd className="numeric-display mt-1 text-sm text-fg">{v}</dd>
    </div>
  );
}

function DownloadBtn({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      download
      className="inline-flex items-center gap-1.5 rounded-btn border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-elevated"
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 3a.75.75 0 01.75.75V11.5l2.7-2.7a.75.75 0 011.06 1.06l-4 4a.75.75 0 01-1.06 0l-4-4a.75.75 0 011.06-1.06l2.7 2.7V3.75A.75.75 0 0110 3z"/><path d="M3.5 13.75A.75.75 0 014.25 13h11.5a.75.75 0 010 1.5H4.25a.75.75 0 01-.75-.75z"/></svg>
      {label}
    </a>
  );
}

function SkeletonRow() {
  return (
    <div className="flex flex-wrap gap-2">
      {[60, 80, 90, 70, 100].map((w, i) => (
        <div key={i} className="skeleton h-7" style={{ width: `${w}px` }} />
      ))}
    </div>
  );
}
