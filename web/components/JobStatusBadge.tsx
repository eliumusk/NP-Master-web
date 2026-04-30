type Status = "queued" | "running" | "done" | "failed" | "canceled";

const ZH_LABEL: Record<Status, string> = {
  queued: "排队中",
  running: "运行中",
  done: "完成",
  failed: "失败",
  canceled: "已取消",
};

const STYLES: Record<Status, string> = {
  queued:   "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  running:  "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200",
  done:     "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  failed:   "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200",
  canceled: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
};

export function JobStatusBadge({ status }: { status: string }) {
  const key = (status as Status) in STYLES ? (status as Status) : "queued";
  const isRunning = key === "running";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[key]}`}>
      {isRunning && <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-current" />}
      {ZH_LABEL[key]}
    </span>
  );
}
