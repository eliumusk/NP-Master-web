"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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

export function JobsTable({ initialJobs, userId }: { initialJobs: Job[]; userId: string }) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);

  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel(`jobs:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "jobs", filter: `user_id=eq.${userId}` },
        (payload) => {
          setJobs((prev) => {
            if (payload.eventType === "INSERT") {
              return [payload.new as Job, ...prev];
            }
            if (payload.eventType === "UPDATE") {
              return prev.map((j) => (j.id === (payload.new as Job).id ? (payload.new as Job) : j));
            }
            if (payload.eventType === "DELETE") {
              return prev.filter((j) => j.id !== (payload.old as Job).id);
            }
            return prev;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId]);

  if (jobs.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No jobs yet. <Link href="/submit" className="underline">Submit one</Link>.
      </p>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th className="py-2 pr-4">Status</th>
          <th className="py-2 pr-4">Job</th>
          <th className="py-2 pr-4">Threshold</th>
          <th className="py-2 pr-4">Created</th>
          <th className="py-2 pr-4">Note</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {jobs.map((j) => (
          <tr key={j.id}>
            <td className="py-2 pr-4"><JobStatusBadge status={j.status} /></td>
            <td className="py-2 pr-4">
              <Link href={`/jobs/${j.id}`} className="font-mono text-xs underline">
                {j.id.slice(0, 8)}
              </Link>
              <div className="text-xs text-slate-500">{(j.fasta_bytes / 1024).toFixed(0)} KB</div>
            </td>
            <td className="py-2 pr-4 tabular-nums">{j.threshold.toFixed(2)}</td>
            <td className="py-2 pr-4 text-slate-500">{new Date(j.created_at).toLocaleString()}</td>
            <td className="py-2 pr-4 text-slate-500">
              {j.error ? <span className="text-red-600">{j.error}</span> : (j.log_tail ?? "")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
