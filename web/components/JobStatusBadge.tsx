type Status = "queued" | "running" | "done" | "failed" | "canceled";

const STYLES: Record<Status, string> = {
  queued:   "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100",
  running:  "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
  done:     "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100",
  failed:   "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
  canceled: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
};

export function JobStatusBadge({ status }: { status: string }) {
  const key = (status as Status) in STYLES ? (status as Status) : "queued";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[key]}`}>
      {status}
    </span>
  );
}
