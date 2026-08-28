"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getOrCreateClientId } from "@/lib/clientId";
import { sha256OfBlob, sniffFasta } from "@/lib/fasta";
import { sniffGff3 } from "@/lib/gff3";
import { useI18n } from "@/lib/i18n/client";
import { ANON_MAX_FILES, AUTH_MAX_FILES, FASTA_MAX_BYTES, GFF3_MAX_BYTES, formatBytes } from "@/lib/limits";

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
  if (value > 0.95) return t.submit.tagStrict;
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
  const [gff3DragOver, setGff3DragOver] = useState(false);
  const [title, setTitle] = useState("");
  const [threshold, setThreshold] = useState(0.95);
  const [extendThreshold, setExtendThreshold] = useState(0.8);
  const [safeTierMin, setSafeTierMin] = useState("Tier2");
  const [notifyEmail, setNotifyEmail] = useState(true);

  const maxBytes = FASTA_MAX_BYTES;
  const maxFiles = isLoggedIn ? AUTH_MAX_FILES : ANON_MAX_FILES;
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
          formatBytes(file.size),
          formatBytes(maxBytes),
        );
      } else {
        const sniff = await sniffFasta(file);
        item.ok = sniff.ok;
        item.message = sniff.ok ? formatBytes(file.size) : sniff.reason;
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
          title: title.trim() || t.submit.defaultTitle,
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
            <span className="text-caption font-medium text-fg-muted">{t.submit.jobTitle}</span>
            <input
              value={title}
              placeholder={t.submit.defaultTitle}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1.5 w-full rounded-btn border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm outline-none transition-colors placeholder:text-fg-subtle focus:border-brand/60 disabled:opacity-50"
            />
          </label>
        )}

        {/* ── ① FASTA ─────────────────────────────────────── */}
        <div>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="font-mono text-xs text-fg-subtle">01</span>
            <span className="text-sm font-semibold">{t.submit.stepFasta}</span>
          </div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void addFiles(e.dataTransfer.files);
            }}
            className={`group cursor-pointer rounded-btn border border-dashed p-8 text-center transition-colors ${
              dragOver
                ? "border-brand/70 bg-brand/[0.07]"
                : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16]"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              multiple={isLoggedIn}
              accept=".fa,.fasta,.fna,.txt,text/plain"
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-btn bg-brand-soft text-brand transition-colors group-hover:bg-brand-softer">
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
                <div key={`${item.file.name}-${i}`} className="rounded-btn border border-white/[0.06] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <input
                        value={item.genomeName}
                        onChange={(e) => setFiles((xs) => xs.map((x, idx) => idx === i ? { ...x, genomeName: e.target.value } : x))}
                        className="w-full rounded-btn border border-white/[0.08] bg-transparent px-2 py-1 font-mono text-xs outline-none focus:border-brand/60"
                      />
                      <div className={`mt-1.5 text-xs ${item.ok === false ? "text-danger" : "text-fg-muted"}`}>
                        {item.file.name} · {item.message ?? t.submit.waitingCheck}
                      </div>
                    </div>
                    <button type="button" onClick={() => removeAt(i)} className="rounded-btn px-2 py-1 text-xs text-fg-subtle transition-colors hover:bg-elevated hover:text-fg">
                      {t.submit.remove}
                    </button>
                  </div>
                  {(item.progress ?? 0) > 0 && (
                    <div className="mt-2 h-1 overflow-hidden rounded-pill bg-white/[0.06]">
                      <div className="h-full rounded-pill bg-brand transition-[width] duration-300" style={{ width: `${item.progress ?? 0}%` }} />
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
            <span className="font-mono text-xs text-fg-subtle">02</span>
            <span className="text-sm font-semibold">{t.submit.stepGff3}</span>
            <span className="rounded-pill bg-white/[0.06] px-2 py-0.5 text-micro text-fg-muted">{t.submit.optional}</span>
          </div>
          <p className="mb-2 text-xs leading-5 text-fg-muted">{t.submit.gff3Help}</p>

          {singleFile?.gff3 ? (
            <div className="flex items-center justify-between gap-3 rounded-btn border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
              <div className={`min-w-0 truncate text-xs ${singleFile.gff3.ok === false ? "text-danger" : "text-fg-muted"}`}>
                <span className="font-medium text-fg">GFF3</span> · {singleFile.gff3.file.name} · {singleFile.gff3.message}
              </div>
              <button type="button" onClick={removeGff3} className="shrink-0 rounded-btn px-2 py-1 text-xs text-fg-subtle transition-colors hover:bg-elevated hover:text-fg">
                {t.submit.remove}
              </button>
            </div>
          ) : (
            <div
              onClick={() => singleFile && gff3InputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                if (singleFile) setGff3DragOver(true);
              }}
              onDragLeave={() => setGff3DragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setGff3DragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void attachGff3(f);
              }}
              className={`rounded-btn border border-dashed px-4 py-4 text-center text-xs transition-colors ${
                !singleFile
                  ? "cursor-not-allowed border-white/[0.06] text-fg-subtle"
                  : gff3DragOver
                    ? "cursor-pointer border-brand/50 text-fg"
                    : "cursor-pointer border-white/[0.08] text-fg-muted hover:border-white/[0.16] hover:text-fg"
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

        <div className="border-t border-white/[0.06]" />

        {/* ── ③ Parameters ────────────────────────────────── */}
        <div>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="font-mono text-xs text-fg-subtle">03</span>
            <span className="text-sm font-semibold">{t.submit.stepParams}</span>
            <span className="text-micro text-fg-subtle">{t.submit.paramsNote}</span>
          </div>
          <div className="space-y-5">
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
              disabled={busy}
            />
            <SliderField
              label={t.submit.extendThreshold}
              help={t.submit.extendHelp}
              value={extendThreshold}
              setValue={setExtendThreshold}
              min={0.5}
              max={threshold}
              step={0.01}
              disabled={busy}
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
                    disabled={busy}
                    onClick={() => setSafeTierMin(opt.v)}
                    className={`rounded-[6px] px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                      safeTierMin === opt.v ? "bg-elevated text-fg" : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-micro text-fg-subtle">{t.submit.tierHelp}</p>
            </div>
          </div>
        </div>

        {isLoggedIn && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.checked)}
              className="checkbox"
            />
            {t.submit.notifyEmail}
          </label>
        )}

        {error && <div className="rounded-btn border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</div>}

        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="btn-primary inline-flex w-full items-center justify-center gap-2 rounded-btn px-4 py-2.5 text-sm font-semibold"
        >
          {busy && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-fg/30 border-t-brand-fg" aria-hidden="true" />
          )}
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

function SliderField({ label, tag, help, value, setValue, min, max, step, disabled }: {
  label: string;
  tag?: string;
  help: string;
  value: number;
  setValue: (v: number) => void;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-fg">{label}</span>
        <span className="flex items-center gap-2">
          {tag && <span className="rounded-pill bg-white/[0.06] px-2 py-0.5 text-micro font-medium text-fg-muted">{tag}</span>}
          <span className="numeric-display text-sm font-medium text-fg">{value.toFixed(2)}</span>
        </span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => setValue(Number(e.target.value))}
        className="slider mt-2 w-full"
      />
      <p className="mt-1 text-micro text-fg-subtle">{help}</p>
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
