"use client";

// Compact submit panel for the landing page hero. Same backend endpoints as
// /submit, but only the bare-minimum UI: pick a file (or paste accession) and
// hit "开始分析". Power users follow the "更多参数 →" link for presets etc.

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { sha256OfBlob, sniffFasta } from "@/lib/fasta";
import { getOrCreateClientId } from "@/lib/clientId";

type Source = "upload" | "accession";
type Phase = "idle" | "hashing" | "creating" | "uploading" | "fetching" | "error";

const ANON_MAX = 25 * 1024 * 1024;
const AUTH_MAX = 50 * 1024 * 1024;
const DEFAULT = { threshold: 0.5, minLenBp: 2000 };

export function LandingSubmit({ isLoggedIn }: { isLoggedIn: boolean }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [source, setSource] = useState<Source>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [accession, setAccession] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [hint, setHint] = useState<{ ok: boolean; msg: string } | null>(null);

  const cap = isLoggedIn ? AUTH_MAX : ANON_MAX;

  async function pickFile(f: File | null) {
    setFile(f); setHint(null);
    if (!f) return;
    if (f.size > cap) {
      setHint({ ok: false, msg: `${(f.size / 1024 / 1024).toFixed(1)} MB · 超过${isLoggedIn ? "" : "匿名"}上限 ${(cap / 1024 / 1024).toFixed(0)} MB` });
      return;
    }
    const r = await sniffFasta(f);
    if (!r.ok) setHint({ ok: false, msg: r.reason });
    else setHint({ ok: true, msg: `${(f.size / 1024 / 1024).toFixed(2)} MB · 看起来是有效的 FASTA` });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (source === "upload") {
      if (!file) { toast.error("请选择 FASTA 文件"); return; }
      if (hint && !hint.ok) { toast.error(hint.msg); return; }
      setPhase("hashing");
      const sha = await sha256OfBlob(file);
      setPhase("creating");
      const r1 = await fetch("/api/jobs/new", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name, sha256: sha, bytes: file.size,
          ...DEFAULT,
          clientId: isLoggedIn ? undefined : getOrCreateClientId(),
        }),
      });
      if (!r1.ok) {
        const j = await r1.json().catch(() => ({}));
        setPhase("error"); toast.error(j.error ?? `创建失败 (${r1.status})`); return;
      }
      const { jobId, uploadUrl } = await r1.json() as { jobId: string; uploadUrl: string };
      setPhase("uploading"); setProgress(0);
      try { await uploadWithProgress(uploadUrl, file, setProgress); }
      catch (e: any) { setPhase("error"); toast.error(`上传失败: ${e.message ?? e}`); return; }
      toast.success(`任务已创建 #${jobId.slice(0, 6)}`);
      router.push(`/jobs/${jobId}`);
    } else {
      if (!accession.trim()) { toast.error("请输入 NCBI accession"); return; }
      setPhase("fetching");
      const r = await fetch("/api/jobs/from-accession", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accession: accession.trim(),
          ...DEFAULT,
          clientId: isLoggedIn ? undefined : getOrCreateClientId(),
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setPhase("error"); toast.error(j.error ?? `拉取失败 (${r.status})`); return;
      }
      const { jobId } = await r.json() as { jobId: string };
      toast.success(`任务已创建 #${jobId.slice(0, 6)}`);
      router.push(`/jobs/${jobId}`);
    }
  }

  const submitting = phase !== "idle" && phase !== "error";

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-section border border-border bg-surface p-5 shadow-sm"
    >
      {/* Source tabs */}
      <div className="flex gap-1 rounded-btn border border-border p-0.5 text-sm">
        {([
          { v: "upload",    label: "上传文件" },
          { v: "accession", label: "NCBI accession" },
        ] as const).map((t) => (
          <button
            key={t.v}
            type="button"
            onClick={() => setSource(t.v)}
            className={`flex-1 rounded-btn px-3 py-1.5 transition-colors ${
              source === t.v
                ? "bg-fg text-bg"
                : "text-fg-muted hover:bg-elevated hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      {source === "upload" ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false);
            const f = e.dataTransfer.files?.[0] ?? null;
            if (f) void pickFile(f);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`mt-3 cursor-pointer rounded-card border-2 border-dashed p-6 text-center transition-colors ${
            dragOver ? "border-brand bg-brand-soft/40"
                     : "border-border hover:border-fg-muted"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".fasta,.fna,.fa,.txt,text/plain"
            onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
            className="sr-only"
          />
          <DnaIcon className="mx-auto h-7 w-7 text-fg-subtle" />
          <div className="mt-2 text-sm font-medium text-fg">
            {file ? file.name : "拖放 FASTA 至此，或点击选择"}
          </div>
          <div className="mt-1 text-xs text-fg-muted">
            .fasta / .fna / .fa · ≤ {(cap / 1024 / 1024).toFixed(0)} MB
          </div>
          {hint && (
            <div className={`mt-2 text-xs ${
              hint.ok ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
            }`}>{hint.msg}</div>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-1.5">
          <input
            type="text"
            value={accession}
            onChange={(e) => setAccession(e.target.value)}
            placeholder="NC_003888.3 / GCA_000156475.1"
            className="numeric-display w-full rounded-btn border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle"
          />
          <p className="text-xs text-fg-muted">服务端会调用 NCBI eutils 拉取，typically 几秒。</p>
        </div>
      )}

      {/* Submit + advanced link */}
      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-btn bg-brand px-4 py-2.5 text-sm font-medium text-brand-fg shadow-sm transition-all hover:opacity-90 disabled:opacity-50"
        >
          {phase === "idle" || phase === "error" ? "开始分析" :
           phase === "hashing"   ? "校验文件…" :
           phase === "creating"  ? "创建任务…" :
           phase === "uploading" ? `上传 ${progress}%` :
           "从 NCBI 拉取…"}
        </button>
        <Link href="/submit" className="text-xs text-fg-muted hover:text-fg">
          更多参数 →
        </Link>
      </div>

      {phase === "uploading" && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-pill bg-elevated">
          <div className="h-full bg-brand transition-[width] duration-100" style={{ width: `${progress}%` }} />
        </div>
      )}

      <p className="mt-3 text-[11px] text-fg-subtle">
        默认参数：阈值 0.50 / 最小 2 kb · 平衡预设
        {!isLoggedIn && <> · 匿名 25 MB（<Link href="/login" className="underline">登录</Link>放宽到 50 MB）</>}
      </p>
    </form>
  );
}

function DnaIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M5 4c0 4 14 4 14 8s-14 4-14 8" />
      <path d="M5 20c0-4 14-4 14-8S5 8 5 4" />
      <path d="M7 7h10M7 17h10" strokeOpacity="0.55" />
    </svg>
  );
}

async function uploadWithProgress(url: string, file: File, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => { xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload ${xhr.status}`)); };
    xhr.onerror = () => reject(new Error("network error"));
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "text/plain");
    xhr.send(file);
  });
}
