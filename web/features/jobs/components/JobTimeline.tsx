import { useI18n } from "@/lib/i18n/client";
import type { JobSummary } from "../types";

// Pipeline stage stepper for the job header. Stages are inferred from
// status + the worker's log_tail strings (serve/pipeline.py update_job calls).

export function JobTimeline({ job }: { job: JobSummary }) {
  const { t } = useI18n();
  const stages = t.workspace.stages;
  const active = inferStage(job.status, job.log_tail);

  return (
    <ol className="flex items-start overflow-x-auto">
      {stages.map((label, i) => {
        let state: StageState;
        if (job.status === "done") state = "done";
        else if (job.status === "failed" || job.status === "canceled") {
          state = i < active ? "done" : i === active ? "failed" : "pending";
        } else {
          state = i < active ? "done" : i === active ? "active" : "pending";
        }
        return (
          <li key={label} className="flex min-w-[4.5rem] flex-1 flex-col last:flex-none">
            <div className="flex items-center">
              <StageDot state={state} />
              {i < stages.length - 1 && (
                <span
                  className={`mx-2 h-px min-w-3 flex-1 ${i < active || job.status === "done" ? "bg-brand/60" : "bg-border"}`}
                />
              )}
            </div>
            <span className={`mt-2 whitespace-nowrap text-micro ${labelClass(state)}`}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

type StageState = "done" | "active" | "failed" | "pending";

function inferStage(status: string, logTail: string | null, stageCount = 6): number {
  if (status === "awaiting_upload" || status === "queued") return 0;
  if (status === "done") return stageCount - 1;
  const log = logTail ?? "";
  if (log.includes("上传结果")) return 4;
  if (log.includes("注释")) return 4;
  if (log.includes("解码") || log.includes("rescue") || log.includes("重建")) return 3;
  if (log.includes("U-Net") || log.includes("预计算")) return 2;
  if (log.includes("Evo2") || log.includes("下载 FASTA")) return 1;
  if (log.includes("已领取")) return 1;
  return status === "running" ? 1 : 0;
}

function StageDot({ state }: { state: StageState }) {
  switch (state) {
    case "done":
      return (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-soft ring-1 ring-inset ring-brand/40">
          <svg className="h-2.5 w-2.5 text-brand" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 5.5l2 2 4-4.5" />
          </svg>
        </span>
      );
    case "active":
      return <span className="pulse-dot block h-3 w-3 shrink-0 rounded-full bg-brand ring-2 ring-brand/30" />;
    case "failed":
      return (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-danger/10 ring-1 ring-inset ring-danger/40">
          <svg className="h-2.5 w-2.5 text-danger" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M3 3l4 4M7 3l-4 4" />
          </svg>
        </span>
      );
    default:
      return <span className="block h-3 w-3 shrink-0 rounded-full bg-elevated ring-1 ring-inset ring-border" />;
  }
}

function labelClass(state: StageState) {
  switch (state) {
    case "done":
      return "text-fg";
    case "active":
      return "font-medium text-brand";
    case "failed":
      return "font-medium text-danger";
    default:
      return "text-fg-subtle";
  }
}
