import type { Dictionary } from "@/lib/i18n";

const STYLES: Record<string, string> = {
  awaiting_upload: "bg-white/[0.06] text-fg-muted ring-1 ring-inset ring-white/[0.08]",
  queued: "bg-white/[0.06] text-fg-muted ring-1 ring-inset ring-white/[0.08]",
  canceled: "bg-white/[0.06] text-fg-muted ring-1 ring-inset ring-white/[0.08]",
  running: "bg-brand-soft text-brand ring-1 ring-inset ring-brand/30",
  done: "bg-success/15 text-success ring-1 ring-inset ring-success/30",
  failed: "bg-danger/15 text-danger ring-1 ring-inset ring-danger/30",
};

const FALLBACK: keyof Dictionary["status"] = "queued";

export function JobStatusBadge({
  status,
  labels,
}: {
  status: string;
  labels: Dictionary["status"];
}) {
  const key = (status in labels ? status : FALLBACK) as keyof Dictionary["status"];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-xs font-medium ${STYLES[key]}`}>
      {key === "running" && <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-pill bg-current" />}
      {labels[key]}
    </span>
  );
}
