import type { Dictionary } from "@/lib/i18n";

const STYLES: Record<string, string> = {
  awaiting_upload: "bg-brand-soft text-brand ring-1 ring-inset ring-brand/30",
  queued: "bg-bgc-other/15 text-bgc-other ring-1 ring-inset ring-bgc-other/30",
  running: "bg-bgc-nrp/15 text-bgc-nrp ring-1 ring-inset ring-bgc-nrp/30",
  done: "bg-bgc-terpene/15 text-bgc-terpene ring-1 ring-inset ring-bgc-terpene/30",
  failed: "bg-bgc-alkaloid/15 text-bgc-alkaloid ring-1 ring-inset ring-bgc-alkaloid/30",
  canceled: "bg-bgc-ripp/15 text-bgc-ripp ring-1 ring-inset ring-bgc-ripp/30",
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
