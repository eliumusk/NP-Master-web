"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getOrCreateClientId } from "@/lib/clientId";
import { sha256OfBlob, sniffFasta } from "@/lib/fasta";
import { useI18n } from "@/lib/i18n/client";

const ANON_MAX_BYTES = 10 * 1024 * 1024;
const AUTH_MAX_BYTES = 50 * 1024 * 1024;
const AUTH_MAX_FILES = 64;

type Phase = "idle" | "hashing" | "creating" | "uploading" | "queueing" | "error";

type Picked = {
  file: File;
  genomeName: string;
  sha256?: string;
  ok?: boolean;
  message?: string;
  progress?: number;
};

type UploadTicket = {
  genomeId: string;
  genomeName: string;
  objectKey: string;
  uploadUrl: string | null;
  alreadyUploaded: boolean;
};

export function BatchSubmit({ isLoggedIn, compact = false }: { isLoggedIn: boolean; compact?: boolean }) {
  const router = useRouter();
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Picked[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [title, setTitle] = useState<string>(t.submit.defaultTitle);
  const [threshold, setThreshold] = useState(0.95);
  const [extendThreshold, setExtendThreshold] = useState(0.8);
  const [safeTierMin, setSafeTierMin] = useState("Tier2");
  const [notifyEmail, setNotifyEmail] = useState(true);

  const maxBytes = isLoggedIn ? AUTH_MAX_BYTES : ANON_MAX_BYTES;
  const maxFiles = isLoggedIn ? AUTH_MAX_FILES : 1;
  const busy = phase !== "idle" && phase !== "error";
  const validFiles = useMemo(() => files.filter((f) => f.ok !== false), [files]);

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
          })),
        }),
      });
      const created = await createRes.json().catch(() => ({}));
      if (!createRes.ok) throw new Error(created.error ?? t.submit.errCreateFailed(createRes.status));

      const tickets = created.uploads as UploadTicket[];
      setPhase("uploading");
      for (const ticket of tickets) {
        if (!ticket.uploadUrl) continue;
        const item = hashed.find((f) => f.genomeName === ticket.genomeName);
        if (!item) continue;
        await uploadWithProgress(ticket.uploadUrl, item.file, (progress) => {
          setFiles((current) => current.map((f) =>
            f.genomeName === ticket.genomeName ? { ...f, progress } : f,
          ));
        });
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
      <div className="space-y-4">
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

        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void addFiles(e.dataTransfer.files);
          }}
          className="group cursor-pointer rounded-card border border-dashed border-white/[0.14] bg-white/[0.02] p-8 text-center transition hover:border-brand/50 hover:bg-brand/[0.04]"
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
          <div className="space-y-2">
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

        <details className="group rounded-btn border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <summary className="flex cursor-pointer select-none items-center justify-between text-xs font-medium text-fg-muted transition hover:text-fg">
            {t.submit.advanced}
            <span className="text-fg-subtle transition group-open:rotate-90">▸</span>
          </summary>
          <div className="mt-3 grid gap-3 pb-1 sm:grid-cols-3">
            <NumberField label={t.submit.threshold} value={threshold} setValue={setThreshold} min={0.05} max={0.99} step={0.01} />
            <NumberField label={t.submit.extendThreshold} value={extendThreshold} setValue={setExtendThreshold} min={0.05} max={0.99} step={0.01} />
            <label className="block">
              <span className="text-[11px] font-medium text-fg-muted">{t.submit.safeTierMin}</span>
              <select
                value={safeTierMin}
                onChange={(e) => setSafeTierMin(e.target.value)}
                className="mt-1 w-full rounded-btn border border-white/[0.08] bg-bg px-2.5 py-2 text-sm outline-none focus:border-brand/60"
              >
                {["Tier1", "Tier2", "Tier3", "Tier4", "Tier5"].map((tier) => <option key={tier}>{tier}</option>)}
              </select>
            </label>
          </div>
        </details>

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

function NumberField({ label, value, setValue, min, max, step }: {
  label: string;
  value: number;
  setValue: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-fg-muted">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setValue(Number(e.target.value))}
        className="mt-1 w-full rounded-btn border border-white/[0.08] bg-bg px-2.5 py-2 text-sm outline-none focus:border-brand/60"
      />
    </label>
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
