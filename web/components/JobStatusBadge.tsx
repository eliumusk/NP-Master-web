const LABELS: Record<string, string> = {
  awaiting_upload: "等待上传",
  queued: "排队中",
  running: "运行中",
  done: "已完成",
  failed: "失败",
  canceled: "已取消",
};

const STYLES: Record<string, string> = {
  awaiting_upload: "bg-brand-soft text-brand",
  queued: "bg-bgc-other-soft text-bgc-other-fg",
  running: "bg-bgc-nrp-soft text-bgc-nrp-fg",
  done: "bg-bgc-terpene-soft text-bgc-terpene-fg",
  failed: "bg-bgc-alkaloid-soft text-bgc-alkaloid-fg",
  canceled: "bg-bgc-ripp-soft text-bgc-ripp-fg",
};

export function JobStatusBadge({ status }: { status: string }) {
  const key = LABELS[status] ? status : "queued";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-xs font-medium ${STYLES[key]}`}>
      {key === "running" && <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-pill bg-current" />}
      {LABELS[key]}
    </span>
  );
}
