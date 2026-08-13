"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";

type Rating = "accurate" | "partial" | "inaccurate";

const RATING_STYLES: Record<Rating, { active: string; base: string }> = {
  accurate: {
    active: "border-emerald-400/50 bg-emerald-400/15 text-emerald-300",
    base: "border-white/[0.08] bg-white/[0.02] text-fg-muted hover:border-emerald-400/40 hover:text-fg",
  },
  partial: {
    active: "border-amber-400/50 bg-amber-400/15 text-amber-300",
    base: "border-white/[0.08] bg-white/[0.02] text-fg-muted hover:border-amber-400/40 hover:text-fg",
  },
  inaccurate: {
    active: "border-rose-400/50 bg-rose-400/15 text-rose-300",
    base: "border-white/[0.08] bg-white/[0.02] text-fg-muted hover:border-rose-400/40 hover:text-fg",
  },
};

export function FeedbackBox({
  jobId,
  regionId,
  isLoggedIn,
  variant,
}: {
  jobId: string;
  regionId: number | null;
  isLoggedIn: boolean;
  variant: "job" | "region";
}) {
  const { t } = useI18n();
  const [rating, setRating] = useState<Rating | null>(null);
  const [comment, setComment] = useState("");
  const [existing, setExisting] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    fetch(`/api/jobs/${jobId}/feedback`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const row = (data.feedback ?? []).find((f: { region_id: number | null }) =>
          regionId == null ? f.region_id == null : f.region_id === regionId,
        );
        if (row) {
          setRating(row.rating as Rating);
          setComment(row.comment ?? "");
          setExisting(true);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [jobId, regionId, isLoggedIn]);

  if (!isLoggedIn) {
    return (
      <div className="rounded-card border border-dashed border-white/[0.1] bg-white/[0.02] p-4 text-xs text-fg-muted">
        {t.feedback.loginHint}
      </div>
    );
  }

  async function submit() {
    if (!rating) return;
    setStatus("saving");
    const res = await fetch(`/api/jobs/${jobId}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ regionId, rating, comment }),
    }).catch(() => null);
    if (res?.ok) {
      setStatus("saved");
      setExisting(true);
    } else {
      setStatus("error");
    }
  }

  const ratings: Rating[] = ["accurate", "partial", "inaccurate"];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {ratings.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => { setRating(r); setStatus("idle"); }}
            className={`rounded-btn border px-3 py-1.5 text-xs font-medium transition ${RATING_STYLES[r][rating === r ? "active" : "base"]}`}
          >
            {t.feedback[r]}
          </button>
        ))}
        {status === "saved" && <span className="text-xs text-brand">{t.feedback.saved}</span>}
        {status === "error" && <span className="text-xs text-rose-300">{t.feedback.error}</span>}
      </div>
      <textarea
        value={comment}
        onChange={(e) => { setComment(e.target.value); setStatus("idle"); }}
        placeholder={t.feedback.commentPlaceholder}
        rows={2}
        className="w-full rounded-btn border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs outline-none transition placeholder:text-fg-subtle focus:border-brand/60"
      />
      <button
        type="button"
        disabled={!rating || status === "saving"}
        onClick={() => void submit()}
        className="btn-primary rounded-btn px-4 py-1.5 text-xs font-semibold"
      >
        {status === "saving" ? t.auth.busy : existing ? t.feedback.update : t.feedback.submit}
      </button>
    </div>
  );
}
