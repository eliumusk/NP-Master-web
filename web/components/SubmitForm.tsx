"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { sha256OfBlob, sniffFasta } from "@/lib/fasta";
import { getOrCreateClientId } from "@/lib/clientId";
import { TurnstileWidget } from "./TurnstileWidget";

const ANON_MAX = 25 * 1024 * 1024;
const AUTH_MAX = 50 * 1024 * 1024;

type Source = "upload" | "accession";
type Phase = "idle" | "hashing" | "creating" | "uploading" | "fetching" | "done" | "error";
type Preset = "recall" | "balanced" | "precision";

const PRESETS: Record<Preset, { threshold: number; minLenBp: number; label: string; desc: string }> = {
  recall:    { threshold: 0.30, minLenBp: 1000, label: "高召回",       desc: "找到尽可能多候选 (thr 0.30, min 1 kb)" },
  balanced:  { threshold: 0.50, minLenBp: 2000, label: "平衡 (推荐)",  desc: "默认操作点 (thr 0.50, min 2 kb)" },
  precision: { threshold: 0.70, minLenBp: 4000, label: "高精度",       desc: "高置信、长片段 (thr 0.70, min 4 kb)" },
};

export function SubmitForm({ isLoggedIn }: { isLoggedIn: boolean }) {
  const router = useRouter();
  const [source, setSource] = useState<Source>("upload");
  const [preset, setPreset] = useState<Preset>("balanced");
  const [threshold, setThreshold] = useState(0.5);
  const [minLenBp, setMinLenBp] = useState(2000);
  const [advanced, setAdvanced] = useState(false);
  const [token, setToken] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");

  // Upload-mode state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [sniffOk, setSniffOk] = useState<boolean | null>(null);
  const [sniffMsg, setSniffMsg] = useState<string>("");

  // Accession-mode state
  const [accession, setAccession] = useState("");

  const cap = isLoggedIn ? AUTH_MAX : ANON_MAX;
  const turnstileEnabled = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    const p = PRESETS[preset];
    setThreshold(p.threshold);
    setMinLenBp(p.minLenBp);
  }, [preset]);

  async function pickFile(f: File | null) {
    setFile(f); setSniffOk(null); setSniffMsg("");
    if (!f) return;
    if (f.size > cap) {
      setSniffOk(false);
      setSniffMsg(`文件 ${(f.size / 1024 / 1024).toFixed(1)} MB · 超过${isLoggedIn ? "" : "匿名"}上限 ${(cap / 1024 / 1024).toFixed(0)} MB${isLoggedIn ? "" : "（登录可放宽到 50 MB）"}`);
      return;
    }
    const result = await sniffFasta(f);
    if (!result.ok) { setSniffOk(false); setSniffMsg(result.reason); }
    else { setSniffOk(true); setSniffMsg(`${(f.size / 1024 / 1024).toFixed(2)} MB · 看起来是有效的 FASTA`); }
  }

  async function submitUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { toast.error("请先选择 FASTA 文件"); return; }
    if (sniffOk === false) { toast.error(sniffMsg || "文件格式校验未通过"); return; }
    if (turnstileEnabled && !token) { toast.error("请先完成人机校验"); return; }

    setPhase("hashing");
    const sha = await sha256OfBlob(file);
    setPhase("creating");
    const r1 = await fetch("/api/jobs/new", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: file.name, sha256: sha, bytes: file.size,
        threshold, minLenBp,
        clientId: isLoggedIn ? undefined : getOrCreateClientId(),
        turnstileToken: token || undefined,
      }),
    });
    if (!r1.ok) {
      const j = await r1.json().catch(() => ({}));
      setPhase("error");
      toast.error(j.error ?? `创建任务失败 (${r1.status})`);
      return;
    }
    const { jobId, uploadUrl } = await r1.json() as { jobId: string; uploadUrl: string };
    setPhase("uploading"); setProgress(0);
    try {
      await uploadWithProgress(uploadUrl, file, setProgress);
    } catch (e: any) {
      setPhase("error");
      toast.error(`上传失败: ${e.message ?? e}`);
      return;
    }
    setPhase("done");
    toast.success(`任务已创建 #${jobId.slice(0, 6)}`, { description: "正在跳转到任务详情页…" });
    router.push(`/jobs/${jobId}`);
  }

  async function submitAccession(e: React.FormEvent) {
    e.preventDefault();
    if (!accession.trim()) { toast.error("请输入 NCBI accession"); return; }
    setPhase("fetching");
    const r = await fetch("/api/jobs/from-accession", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accession: accession.trim(), threshold, minLenBp,
        clientId: isLoggedIn ? undefined : getOrCreateClientId(),
      }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setPhase("error");
      toast.error(j.error ?? `拉取失败 (${r.status})`);
      return;
    }
    const { jobId } = await r.json() as { jobId: string };
    setPhase("done");
    toast.success(`任务已创建 #${jobId.slice(0, 6)}`);
    router.push(`/jobs/${jobId}`);
  }

  return (
    <div className="space-y-6">
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
            className={`flex-1 rounded-btn px-3 py-2 transition-colors ${
              source === t.v
                ? "bg-fg text-bg"
                : "text-fg-muted hover:bg-elevated hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <form onSubmit={source === "upload" ? submitUpload : submitAccession} className="space-y-6">
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
            className={`relative cursor-pointer rounded-section border-2 border-dashed p-12 text-center transition-colors ${
              dragOver ? "border-brand bg-brand-soft/40"
                       : "border-border hover:border-fg-muted"
            }`}
          >
            <input ref={fileInputRef} type="file" accept=".fasta,.fna,.fa,.txt,text/plain"
                   onChange={(e) => void pickFile(e.target.files?.[0] ?? null)} className="sr-only" />
            <DnaIcon className="mx-auto h-10 w-10 text-fg-subtle" />
            <div className="mt-3 text-sm font-medium text-fg">
              {file ? file.name : "拖放 FASTA 文件至此，或点击选择"}
            </div>
            <div className="mt-1 text-xs text-fg-muted">
              支持 .fasta · .fna · .fa · 上限 {(cap / 1024 / 1024).toFixed(0)} MB
              {!isLoggedIn && <>（<span className="text-fg">登录可放宽到 50 MB</span>）</>}
            </div>
            {sniffOk !== null && (
              <div className={`mt-3 inline-flex rounded-btn px-3 py-1 text-xs ${
                sniffOk ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                        : "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
              }`}>{sniffMsg}</div>
            )}
          </div>
        ) : (
          <label className="block">
            <span className="text-sm font-medium text-fg">NCBI accession</span>
            <input
              type="text"
              value={accession}
              onChange={(e) => setAccession(e.target.value)}
              placeholder="例如 NC_003888.3 或 GCA_000156475.1"
              className="numeric-display mt-1.5 w-full rounded-btn border border-border bg-surface px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle"
              required
            />
            <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">
              我们会调用 NCBI eutils 拉取该 accession 对应的 FASTA（typically 几秒），
              然后跑标准流程。支持 nuccore 库里的 RefSeq / GenBank 序列。
            </p>
          </label>
        )}

        {/* Presets */}
        <div className="space-y-3">
          <div className="text-sm font-medium text-fg">检测预设</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(PRESETS) as Preset[]).map((k) => {
              const p = PRESETS[k];
              const active = preset === k;
              return (
                <button
                  key={k} type="button" onClick={() => setPreset(k)}
                  className={`rounded-card border p-3 text-left transition-colors ${
                    active ? "border-brand bg-brand-soft/40"
                           : "border-border hover:border-fg-muted"
                  }`}
                >
                  <div className="text-sm font-semibold text-fg">{p.label}</div>
                  <div className="mt-1 text-xs leading-relaxed text-fg-muted">{p.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        <details
          open={advanced}
          onToggle={(e) => setAdvanced((e.target as HTMLDetailsElement).open)}
          className="rounded-card border border-border"
        >
          <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-medium text-fg">
            高级参数（覆盖预设）
          </summary>
          <div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2">
            <Slider
              label="阈值 (sigmoid)"
              min={0.05} max={0.95} step={0.05}
              value={threshold} onChange={setThreshold}
              format={(v) => v.toFixed(2)}
            />
            <Slider
              label="最小区域长度"
              min={500} max={20000} step={500}
              value={minLenBp} onChange={setMinLenBp}
              format={(v) => `${(v / 1000).toFixed(1)} kb`}
            />
          </div>
        </details>

        {turnstileEnabled && source === "upload" && <TurnstileWidget onToken={setToken} />}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={phase !== "idle" && phase !== "error"}
            className="rounded-btn bg-brand px-5 py-2.5 text-sm font-medium text-brand-fg shadow-sm transition-all hover:opacity-90 disabled:opacity-50"
          >
            {phase === "idle" || phase === "error" ? "开始分析" :
             phase === "hashing"   ? "校验文件…" :
             phase === "creating"  ? "创建任务…" :
             phase === "uploading" ? `上传中 ${progress}%` :
             phase === "fetching"  ? "从 NCBI 拉取…" : "完成"}
          </button>
          {phase === "uploading" && (
            <div className="h-2 flex-1 overflow-hidden rounded-pill bg-elevated">
              <div className="h-full bg-brand transition-[width] duration-100" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange, format }: {
  label: string; min: number; max: number; step: number;
  value: number; onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-fg-muted">{label}</span>
        <span className="numeric-display text-sm text-fg">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-brand"
      />
    </label>
  );
}

function DnaIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M5 4c0 4 14 4 14 8s-14 4-14 8" />
      <path d="M5 20c0-4 14-4 14-8S5 8 5 4" />
      <path d="M7 7h10M7 17h10M5.5 10h13M5.5 14h13" strokeOpacity="0.55" />
    </svg>
  );
}

async function uploadWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(new Error(`upload failed: ${xhr.status}`)); };
    xhr.onerror = () => reject(new Error("network error during upload"));
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "text/plain");
    xhr.send(file);
  });
}
