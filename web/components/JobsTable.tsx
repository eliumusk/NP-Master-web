"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { JobStatusBadge } from "./JobStatusBadge";
import { CopyButton } from "./CopyButton";

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
  // Re-render every 5s so "用时" of running jobs ticks.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const filterStr = userId ? `user_id=eq.${userId}` : (clientId ? `client_id=eq.${clientId}` : null);
    if (!filterStr) return;
    const ch = supabase
      .channel(`jobs:${userId ?? clientId}`)
      .on("postgres_changes",
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
      <div className="rounded-card border border-dashed border-border bg-elevated/40 p-12 text-center">
        <p className="text-sm text-fg-muted">还没有任务。</p>
        <Link href="/submit" className="mt-2 inline-block text-sm font-medium text-brand hover:underline">
          提交第一个 →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-btn border border-border p-0.5 text-sm">
          {(["all", "active", "done", "failed"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-btn px-3 py-1.5 transition-colors ${
                filter === f
                  ? "bg-fg text-bg"
                  : "text-fg-muted hover:bg-elevated hover:text-fg"
              }`}
            >
              {f === "all" ? "全部" : f === "active" ? "进行中" : f === "done" ? "完成" : "失败"}
              <span className="ml-1.5 text-fg-subtle">{countByFilter(jobs, f)}</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="搜索 ID / sha256…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto w-56 rounded-btn border border-border bg-surface px-3 py-1.5 text-sm placeholder:text-fg-subtle"
        />
      </div>

      <div className="overflow-hidden rounded-card border border-border">
        <table className="w-full text-sm">
          <colgroup>
            <col style={{ width: "5.5rem" }} />
            <col style={{ width: "11rem" }} />
            <col />
            <col style={{ width: "6rem" }} />
            <col style={{ width: "9rem" }} />
            <col style={{ width: "6rem" }} />
          </colgroup>
          <thead className="bg-elevated/60 text-left text-xs uppercase tracking-wider text-fg-muted">
            <tr>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">参数 / 大小</th>
              <th className="px-4 py-3 text-right">用时</th>
              <th className="px-4 py-3">提交时间</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((j) => {
              const dur = jobDurationMs(j);
              return (
                <tr key={j.id} className="even:bg-elevated/20 hover:bg-elevated/60">
                  <td className="px-4 py-3"><JobStatusBadge status={j.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Link href={`/jobs/${j.id}`} className="numeric-display text-xs text-brand hover:underline">
                        {j.id.slice(0, 8)}
                      </Link>
                      <CopyButton value={j.id} label="job ID" />
                    </div>
                    {j.error && <div className="mt-0.5 truncate text-xs text-rose-500">{j.error.slice(0, 80)}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-fg-muted">
                    <span className="numeric-display">{j.threshold.toFixed(2)}</span>
                    {" / "}
                    <span className="numeric-display">{(j.min_len_bp / 1000).toFixed(1)} kb</span>
                    {" · "}
                    <span className="numeric-display">{(j.fasta_bytes / 1024 / 1024).toFixed(1)} MB</span>
                  </td>
                  <td className="numeric-display px-4 py-3 text-right text-sm text-fg">
                    {dur ? fmtDuration(dur) : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-fg-muted">
                    {fmtRelative(j.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/jobs/${j.id}`} className="text-xs text-fg-muted hover:text-fg">
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

function countByFilter(jobs: Job[], f: "all" | "active" | "done" | "failed"): number {
  if (f === "all") return jobs.length;
  if (f === "active") return jobs.filter((j) => ["queued", "running"].includes(j.status)).length;
  if (f === "done") return jobs.filter((j) => j.status === "done").length;
  return jobs.filter((j) => j.status === "failed").length;
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
