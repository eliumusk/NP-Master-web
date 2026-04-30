"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { JobStatusBadge } from "./JobStatusBadge";

type Job = {
  id: string;
  status: string;
  fasta_sha256: string;
  fasta_bytes: number;
  threshold: number;
  min_len_bp: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  log_tail: string | null;
};

export function JobsTable({
  initialJobs, userId, clientId,
}: { initialJobs: Job[]; userId: string | null; clientId: string | null }) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "done" | "failed">("all");

  useEffect(() => {
    const supabase = createClient();
    const filterStr = userId ? `user_id=eq.${userId}` : (clientId ? `client_id=eq.${clientId}` : null);
    if (!filterStr) return;
    const ch = supabase
      .channel(`jobs:${userId ?? clientId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "jobs", filter: filterStr },
        (payload) => {
          setJobs((prev) => {
            if (payload.eventType === "INSERT") return [payload.new as Job, ...prev];
            if (payload.eventType === "UPDATE") return prev.map((j) => (j.id === (payload.new as Job).id ? (payload.new as Job) : j));
            if (payload.eventType === "DELETE") return prev.filter((j) => j.id !== (payload.old as Job).id);
            return prev;
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, clientId]);

  const filtered = useMemo(() => {
    return jobs.filter((j) => {
      if (filter === "active" && !["queued", "running"].includes(j.status)) return false;
      if (filter === "done" && j.status !== "done") return false;
      if (filter === "failed" && j.status !== "failed") return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(j.id.toLowerCase().includes(q) || j.fasta_sha256.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [jobs, search, filter]);

  if (jobs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 p-12 text-center dark:border-slate-700 dark:bg-slate-900/40">
        <p className="text-sm text-slate-500">还没有任务。</p>
        <Link href="/submit" className="mt-2 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300">
          提交第一个 →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-md border border-slate-200 p-0.5 text-xs dark:border-slate-800">
          {(["all", "active", "done", "failed"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded px-2.5 py-1 transition-colors ${
                filter === f
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              }`}
            >
              {f === "all" ? "全部" : f === "active" ? "进行中" : f === "done" ? "完成" : "失败"}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="搜索 ID / sha256…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500 dark:bg-slate-900/60">
            <tr>
              <th className="px-4 py-2.5">状态</th>
              <th className="px-4 py-2.5">ID</th>
              <th className="px-4 py-2.5">阈值 / 最小长度</th>
              <th className="px-4 py-2.5">大小</th>
              <th className="px-4 py-2.5">提交时间</th>
              <th className="px-4 py-2.5">用时</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-950">
            {filtered.map((j) => {
              const dur = jobDurationMs(j);
              return (
                <tr key={j.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40">
                  <td className="px-4 py-2.5"><JobStatusBadge status={j.status} /></td>
                  <td className="px-4 py-2.5">
                    <Link href={`/jobs/${j.id}`} className="font-mono text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                      {j.id.slice(0, 8)}
                    </Link>
                    {j.error && <div className="mt-0.5 truncate text-xs text-rose-500">{j.error.slice(0, 80)}</div>}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-xs text-slate-600 dark:text-slate-400">
                    {j.threshold.toFixed(2)} / {(j.min_len_bp / 1000).toFixed(1)} kb
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-xs text-slate-600 dark:text-slate-400">
                    {(j.fasta_bytes / 1024 / 1024).toFixed(1)} MB
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">
                    {fmtRelative(j.created_at)}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-xs text-slate-600 dark:text-slate-400">
                    {dur ? fmtDuration(dur) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/jobs/${j.id}`} className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">
                      详情 →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function jobDurationMs(j: Job): number | null {
  const start = j.started_at ?? j.created_at;
  const end = j.finished_at ?? (j.status === "running" ? new Date().toISOString() : null);
  if (!end) return null;
  return Date.parse(end) - Date.parse(start);
}

function fmtDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)} 秒`;
  return `${(ms / 60_000).toFixed(1)} 分`;
}

function fmtRelative(iso: string): string {
  const dt = (Date.now() - Date.parse(iso)) / 1000;
  if (dt < 60) return "刚刚";
  if (dt < 3600) return `${Math.floor(dt / 60)} 分钟前`;
  if (dt < 86400) return `${Math.floor(dt / 3600)} 小时前`;
  if (dt < 604800) return `${Math.floor(dt / 86400)} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}
