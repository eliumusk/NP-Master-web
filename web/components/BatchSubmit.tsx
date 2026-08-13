"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getOrCreateClientId } from "@/lib/clientId";
import { sha256OfBlob, sniffFasta } from "@/lib/fasta";
import { sniffGff3 } from "@/lib/gff3";
import { useI18n } from "@/lib/i18n/client";

const ANON_MAX_BYTES = 10 * 1024 * 1024;
const AUTH_MAX_BYTES = 50 * 1024 * 1024;
const AUTH_MAX_FILES = 64;
const GFF3_MAX_BYTES = 20 * 1024 * 1024;

type Phase = "idle" | "hashing" | "creating" | "uploading" | "queueing" | "error";

type Gff3Picked = {
  file: File;
  sha256?: string;
  ok?: boolean;
  message?: string;
};

type Picked = {
  file: File;
  genomeName: string;
  sha256?: string;
  ok?: boolean;
  message?: string;
  progress?: number;
  gff3?: Gff3Picked;
};

type UploadTicket = {
  genomeId: string;
  genomeName: string;
  objectKey: string;
  uploadUrl: string | null;
  alreadyUploaded: boolean;
  gff3UploadUrl?: string | null;
};

function strictnessTag(value: number, t: ReturnType<typeof useI18n>["t"]) {
  if (value >= 0.95) return t.submit.tagStrict;
  if (value >= 0.85) return t.submit.tagStandard;
  return t.submit.tagLoose;
}

export function BatchSubmit({ isLoggedIn, compact = false }: { isLoggedIn: boolean; compact?: boolean }) {
  const router = useRouter();
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const gff3InputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Picked[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [title, setTitle] = useState<string>(t.submit.defaultTitle);
  const [threshold, setThreshold] = useState(0.95);
  const [extendThreshold, setExtendThreshold] = useState(0.8);
  const [safeTierMin, setSafeTierMin] = useState("Tier2");
  const [notifyEmail, setNotifyEmail] = useState(true);

  const maxBytes = isLoggedIn ? AUTH_MAX_BYTES : ANON_MAX_BYTES;
  const maxFiles = isLoggedIn ? AUTH_MAX_FILES : 1;
  const busy = phase !== "idle" && phase !== "error";
  const validFiles = useMemo(() => files.filter((f) => f.ok !== false), [files]);
  const singleFile = files.length === 1 ? files[0] : null;

  async function addFiles(list: FileList | File[]) {
    setError("");
    const incoming = Array.from(list).filter(Boolean);
    const next = [...files];
    for (const file of incoming) {
      if (next.length >= maxFiles) break;
      const item: Picked = { file, genomeName: genomeNameFromFile(file.name), progress: 0 };
      if (file.size > maxBytes) {
        item.ok = false;
        item.message = t.submit.errTooLarge(
          (file.size / 1024 / 1024).toFixed(1),
          (maxBytes / 1024 / 1024).toFixed(0),
        );
      } else {
        const sniff = await sniffFasta(file);
        item.ok = sniff.ok;
        item.message = sniff.ok ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : sniff.reason;
      }
      next.push(item);
    }
    setFiles(next);
  }

  function removeAt(i: number) {
    setFiles((xs) => xs.filter((_, idx) => idx !== i));
  }

  async function attachGff3(file: File) {
    if (!singleFile) return;
    const item: Gff3Picked = { file };
    if (file.size > GFF3_MAX_BYTES) {
      item.ok = false;
      item.message = t.submit.gff3TooLarge;
    } else {
      const sniff = await sniffGff3(file);
      item.ok = sniff.ok;
      item.message = sniff.ok
        ? `${(file.size / 1024 / 1024).toFixed(2)} MB`
        : t.submit[sniff.reasonKey === "empty" ? "gff3Empty" : "gff3Invalid"];
    }
    setFiles((xs) => xs.map((x, idx) => (idx === 0 ? { ...x, gff3: item } : x)));
  }

  function removeGff3() {
    setFiles((xs) => xs.map((x, idx) => (idx === 0 ? { ...x, gff3: undefined } : x)));
  }

  async function submit() {
    setError("");
    if (validFiles.length === 0) {
      setError(t.submit.errNoFiles);
      return;
    }
    if (!isLoggedIn && validFiles.length > 1) {
      setError(t.submit.errAnonMulti);
      return;
    }
    if (extendThreshold > threshold) {
      setError(t.submit.errThreshold);
      return;
    }

    try {
      setPhase("hashing");
      const hashed = await Promise.all(validFiles.map(async (item) => ({
        ...item,
        sha256: await sha256OfBlob(item.file),
        gff3: item.gff3?.ok ? { ...item.gff3, sha256: await sha256OfBlob(item.gff3.file) } : item.gff3,
      })));
      setFiles(hashed);

      setPhase("creating");
      const clientId = isLoggedIn ? undefined : getOrCreateClientId();
      const createRes = await fetch("/api/jobs/new", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          threshold,
          extendThreshold,
          minSupportWindows: 3,
          minLenBp: 2000,
          safeTierMin,
          extendFlankBp: 5000,
          notifyEmail,
          clientId,
          genomes: hashed.map((item) => ({
            filename: item.file.name,
            genomeName: item.genomeName,
            sha256: item.sha256,
            bytes: item.file.size,
            gff3: item.gff3?.ok && item.gff3.sha256
              ? { filename: item.gff3.file.name, sha256: item.gff3.sha256, bytes: item.gff3.file.size }
              : undefined,
          })),
        }),
      });
      const created = await createRes.json().catch(() => ({}));
      if (!createRes.ok) throw new Error(created.error ?? t.submit.errCreateFailed(createRes.status));

      const tickets = created.uploads as UploadTicket[];
      setPhase("uploading");
      for (const ticket of tickets) {
        const item = hashed.find((f) => f.genomeName === ticket.genomeName);
        if (!item) continue;
        if (ticket.uploadUrl) {
          await uploadWithProgress(ticket.uploadUrl, item.file, (progress) => {
            setFiles((current) => current.map((f) =>
              f.genomeName === ticket.genomeName ? { ...f, progress } : f,
            ));
          });
        }
        if (ticket.gff3UploadUrl && item.gff3?.ok) {
          await uploadWithProgress(ticket.gff3UploadUrl, item.gff3.file, () => {});
        }
      }

      setPhase("queueing");
      const doneRes = await fetch(`/api/jobs/${created.jobId}/complete-upload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const done = await doneRes.json().catch(() => ({}));
      if (!doneRes.ok) throw new Error(done.error ?? t.submit.errQueueFailed(doneRes.status));
      router.push(`/jobs/${created.jobId}`);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="panel p-5">
      <div className="space-y-5">
        {!compact && (
          <label className="block">
            <span className="text-sm font-medium">{t.submit.jobTitle}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1.5 w-full rounded-btn border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm outline-none transition placeholder:text-fg-subtle focus:border-brand/60"
            />
          </label>
        )}

        {/* ── ① FASTA ─────────────────────────────────────── */}
        <div>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="font-mono text-xs text-brand">01</span>
            <span className="text-sm font-semibold">{t.submit.stepFasta}</span>
            <span className="text-xs text-rose-300">*</span>
          </div>
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void addFiles(e.dataTransfer.files);
            }}
            className={`group cursor-pointer rounded-card border border-dashed p-8 text-center transition ${
              dragOver
                ? "border-brand/70 bg-brand/[0.07]"
                : "border-white/[0.14] bg-white/[0.02] hover:border-brand/50 hover:bg-brand/[0.04]"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              multiple={isLoggedIn}
              accept=".fa,.fasta,.fna,.txt,text/plain"
              className="sr-only"
              onChange={(e) => e.target.files && void addFiles(e.target.files)}
            />
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-btn bg-brand-soft text-brand transition group-hover:bg-brand-softer">
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 14V4m0 0L6 8m4-4l4 4M4 16h12" />
              </svg>
            </div>
            <div className="mt-3 text-sm font-medium">{t.submit.dropMain}</div>
            <div className="mt-1 text-xs text-fg-subtle">
              {isLoggedIn ? t.submit.dropAuth : t.submit.dropAnon}
            </div>
          </div>

          {files.length > 0 && (
            <div className="mt-2 space-y-2">
              {files.map((item, i) => (
                <div key={`${item.file.name}-${i}`} className="rounded-btn border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <input
                        value={item.genomeName}
                        onChange={(e) => setFiles((xs) => xs.map((x, idx) => idx === i ? { ...x, genomeName: e.target.value } : x))}
                        className="w-full rounded-btn border border-white/[0.08] bg-bg px-2 py-1 font-mono text-xs outline-none focus:border-brand/60"
                      />
                      <div className={`mt-1.5 text-xs ${item.ok === false ? "text-rose-300" : "text-fg-muted"}`}>
                        {item.file.name} · {item.message ?? t.submit.waitingCheck}
                      </div>
                    </div>
                    <button type="button" onClick={() => removeAt(i)} className="rounded-btn px-2 py-1 text-xs text-fg-subtle transition hover:bg-elevated hover:text-fg">
                      {t.submit.remove}
                    </button>
                  </div>
                  {(item.progress ?? 0) > 0 && (
                    <div className="mt-2 h-1 overflow-hidden rounded-pill bg-white/[0.06]">
                      <div className="h-full rounded-pill bg-gradient-to-r from-brand/70 to-brand transition-all" style={{ width: `${item.progress ?? 0}%` }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── ② GFF3 (optional) ───────────────────────────── */}
        <div>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="font-mono text-xs text-brand">02</span>
            <span className="text-sm font-semibold">{t.submit.stepGff3}</span>
            <span className="rounded-pill bg-white/[0.06] px-2 py-0.5 text-[10px] text-fg-muted">{t.submit.optional}</span>
          </div>
          <p className="mb-2 text-xs leading-5 text-fg-muted">{t.submit.gff3Help}</p>

          {singleFile?.gff3 ? (
            <div className="flex items-center justify-between gap-3 rounded-btn border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
              <div className={`min-w-0 truncate text-xs ${singleFile.gff3.ok === false ? "text-rose-300" : "text-fg-muted"}`}>
                <span className="font-medium text-fg">GFF3</span> · {singleFile.gff3.file.name} · {singleFile.gff3.message}
              </div>
              <button type="button" onClick={removeGff3} className="shrink-0 rounded-btn px-2 py-1 text-xs text-fg-subtle transition hover:bg-elevated hover:text-fg">
                {t.submit.remove}
              </button>
            </div>
          ) : (
            <div
              onClick={() => singleFile && gff3InputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) void attachGff3(f);
              }}
              className={`rounded-btn border border-dashed px-4 py-4 text-center text-xs transition ${
                singleFile
                  ? "cursor-pointer border-white/[0.12] bg-white/[0.015] text-fg-muted hover:border-brand/40 hover:text-fg"
                  : "cursor-not-allowed border-white/[0.06] text-fg-subtle"
              }`}
            >
              <input
                ref={gff3InputRef}
                type="file"
                accept=".gff,.gff3,text/plain"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void attachGff3(f);
                  e.target.value = "";
                }}
              />
              {singleFile ? t.submit.gff3Drop : files.length > 1 ? t.submit.gff3MultiNote : t.submit.gff3NeedFasta}
            </div>
          )}
        </div>

        {/* ── ③ Parameters ────────────────────────────────── */}
        <div>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="font-mono text-xs text-brand">03</span>
            <span className="text-sm font-semibold">{t.submit.stepParams}</span>
            <span className="text-[11px] text-fg-subtle">{t.submit.paramsNote}</span>
          </div>
          <div className="space-y-5 rounded-btn border border-white/[0.06] bg-white/[0.02] p-4">
            <SliderField
              label={t.submit.threshold}
              tag={strictnessTag(threshold, t)}
              help={t.submit.thresholdHelp}
              value={threshold}
              setValue={(v) => {
                setThreshold(v);
                if (extendThreshold > v) setExtendThreshold(v);
              }}
              min={0.5}
              max={0.99}
              step={0.01}
            />
            <SliderField
              label={t.submit.extendThreshold}
              help={t.submit.extendHelp}
              value={extendThreshold}
              setValue={setExtendThreshold}
              min={0.5}
              max={threshold}
              step={0.01}
            />
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-fg">{t.submit.safeTierMin}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1 rounded-btn border border-white/[0.08] bg-white/[0.02] p-1">
                {([
                  { v: "Tier1", label: t.submit.tierStrict },
                  { v: "Tier2", label: t.submit.tierStandard },
                  { v: "Tier3", label: t.submit.tierLoose },
                ] as const).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setSafeTierMin(opt.v)}
                    className={`rounded-btn px-2 py-1.5 text-xs font-medium transition ${
                      safeTierMin === opt.v ? "bg-elevated text-fg" : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-4 text-fg-subtle">{t.submit.tierHelp}</p>
            </div>
          </div>
        </div>

        {isLoggedIn && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.checked)}
              className="h-3.5 w-3.5 accent-brand"
            />
            {t.submit.notifyEmail}
          </label>
        )}

        {error && <div className="rounded-card border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200">{error}</div>}

        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="btn-primary w-full rounded-btn px-4 py-2.5 text-sm font-semibold"
        >
          {phase === "idle" || phase === "error" ? t.submit.btnCreate :
           phase === "hashing" ? t.submit.phaseHashing :
           phase === "creating" ? t.submit.phaseCreating :
           phase === "uploading" ? t.submit.phaseUploading :
           t.submit.phaseQueueing}
        </button>
      </div>
    </section>
  );
}

function SliderField({ label, tag, help, value, setValue, min, max, step }: {
  label: string;
  tag?: string;
  help: string;
  value: number;
  setValue: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-fg">{label}</span>
        <span className="flex items-center gap-2">
          {tag && <span className="rounded-pill bg-brand-soft px-2 py-0.5 text-[10px] font-medium text-brand">{tag}</span>}
          <span className="numeric-display text-sm font-medium text-fg">{value.toFixed(2)}</span>
        </span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setValue(Number(e.target.value))}
        className="mt-2 w-full accent-brand"
      />
      <p className="mt-1 text-[11px] leading-4 text-fg-subtle">{help}</p>
    </div>
  );
}

function genomeNameFromFile(name: string): string {
  return name
    .replace(/\.(fasta|fna|fa|txt)$/i, "")
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .slice(0, 120) || "genome";
}

function uploadWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("network error during upload"));
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", "text/plain");
    xhr.send(file);
  });
}
