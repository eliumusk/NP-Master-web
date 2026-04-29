"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { JobStatusBadge } from "./JobStatusBadge";
import { RegionTable } from "./RegionTable";
import { IgvBrowser } from "./IgvBrowser";

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

type Region = { contig: string; start_bp: number; end_bp: number; score: number };

export function JobDetail({ initialJob, initialRegions }: { initialJob: Job; initialRegions: Region[] }) {
  const [job, setJob] = useState<Job>(initialJob);
  const [regions, setRegions] = useState<Region[]>(initialRegions);
  const [urls, setUrls] = useState<{ fasta?: string; fai?: string; bed?: string; csv?: string }>({});

  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel(`job:${job.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${job.id}` },
        (payload) => setJob(payload.new as Job),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "regions", filter: `job_id=eq.${job.id}` },
        (payload) => setRegions((rs) => [...rs, payload.new as Region]),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [job.id]);

  // Once job is done, fetch signed URLs for the IGV viewer + downloads.
  useEffect(() => {
    if (job.status !== "done") return;
    if (urls.bed) return;
    (async () => {
      const kinds = ["fasta", "fai", "bed", "csv"] as const;
      const out: Partial<Record<(typeof kinds)[number], string>> = {};
      for (const k of kinds) {
        const r = await fetch(`/api/jobs/${job.id}/signed-url?kind=${k}`);
        if (!r.ok) return;
        const j = await r.json();
        out[k] = j.url as string;
      }
      setUrls(out);
    })().catch((e) => console.error(e));
  }, [job.status, job.id, urls.bed]);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">
          Job <span className="font-mono text-base text-slate-500">{job.id.slice(0, 8)}</span>
        </h1>
        <JobStatusBadge status={job.status} />
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-4">
        <KV k="Threshold" v={job.threshold.toFixed(2)} />
        <KV k="Min length" v={`${job.min_len_bp.toLocaleString()} bp`} />
        <KV k="FASTA size" v={`${(job.fasta_bytes / 1024).toFixed(0)} KB`} />
        <KV k="Created" v={new Date(job.created_at).toLocaleString()} />
      </dl>

      {job.error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100">
          <div className="font-medium">Failed</div>
          <pre className="mt-1 whitespace-pre-wrap text-xs">{job.error}</pre>
          {job.log_tail && <pre className="mt-2 whitespace-pre-wrap text-xs opacity-75">{job.log_tail}</pre>}
        </div>
      )}

      {(job.status === "queued" || job.status === "running") && (
        <div className="rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-100">
          <div className="font-medium">{job.status === "queued" ? "Waiting in queue" : "Running"}</div>
          {job.log_tail && <pre className="mt-1 whitespace-pre-wrap text-xs">{job.log_tail}</pre>}
        </div>
      )}

      {job.status === "done" && (
        <>
          <div className="flex flex-wrap gap-3">
            {urls.csv && <a className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900" href={urls.csv} download>Download CSV</a>}
            {urls.bed && <a className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900" href={urls.bed} download>Download BED</a>}
            {urls.fasta && <a className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900" href={urls.fasta} download>Download FASTA</a>}
          </div>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Regions ({regions.length})</h2>
            <RegionTable regions={regions} />
          </section>

          {urls.fasta && urls.fai && urls.bed && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">IGV browser</h2>
              <IgvBrowser fastaUrl={urls.fasta} faiUrl={urls.fai} bedUrl={urls.bed} />
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
      <dt className="text-xs uppercase tracking-wide text-slate-500">{k}</dt>
      <dd className="mt-1 text-sm tabular-nums">{v}</dd>
    </div>
  );
}
