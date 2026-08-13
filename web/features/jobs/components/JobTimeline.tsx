import { useI18n } from "@/lib/i18n/client";
import type { JobSummary } from "../types";

// Pipeline stage stepper for the job header. Stages are inferred from
// status + the worker's log_tail strings (serve/pipeline.py update_job calls).

export function JobTimeline({ job }: { job: JobSummary }) {
  const { t } = useI18n();
  const stages = t.workspace.stages;
  const active = inferStage(job.status, job.log_tail);

  return (
    <ol className="flex items-start">
      {stages.map((label, i) => {
        let state: StageState;
        if (job.status === "done") state = "done";
        else if (job.status === "failed" || job.status === "canceled") {
          state = i < active ? "done" : i === active ? "failed" : "pending";
        } else {
          state = i < active ? "done" : i === active ? "active" : "pending";
        }
        return (
          <li key={label} className="flex min-w-0 flex-1 items-start last:flex-none">
            <div className="flex min-w-0 flex-col items-center">
              <span className={dotClass(state)} />
              <span className={`mt-2 whitespace-nowrap text-[11px] ${labelClass(state)}`}>{label}</span>
            </div>
            {i < stages.length - 1 && (
              <span
                className={`mx-2 mt-[7px] h-px min-w-3 flex-1 ${i < active || job.status === "done" ? "bg-brand/60" : "bg-border"}`}
              />
            )}
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

function dotClass(state: StageState) {
  const base = "block h-3.5 w-3.5 rounded-full";
  switch (state) {
    case "done":
      return `${base} bg-brand`;
    case "active":
      return `${base} pulse-dot bg-brand ring-4 ring-brand/25`;
    case "failed":
      return `${base} bg-rose-400 ring-4 ring-rose-400/25`;
    default:
      return `${base} bg-elevated ring-1 ring-inset ring-border`;
  }
}

function labelClass(state: StageState) {
  switch (state) {
    case "done":
      return "text-fg";
    case "active":
      return "font-medium text-brand";
    case "failed":
      return "font-medium text-rose-300";
    default:
      return "text-fg-subtle";
  }
}
