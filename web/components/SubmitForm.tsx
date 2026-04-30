"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sha256OfBlob, sniffFasta } from "@/lib/fasta";
import { getOrCreateClientId } from "@/lib/clientId";
import { TurnstileWidget } from "./TurnstileWidget";

const ANON_MAX = 25 * 1024 * 1024;
const AUTH_MAX = 50 * 1024 * 1024;

type Phase = "idle" | "hashing" | "creating" | "uploading" | "done" | "error";
type Preset = "recall" | "balanced" | "precision";

const PRESETS: Record<Preset, { threshold: number; minLenBp: number; label: string; desc: string }> = {
  recall:    { threshold: 0.30, minLenBp: 1000, label: "高召回", desc: "找到尽可能多候选，包括边缘信号 (thr=0.30, min=1 kb)" },
  balanced:  { threshold: 0.50, minLenBp: 2000, label: "平衡 (推荐)", desc: "默认操作点 (thr=0.50, min=2 kb)" },
  precision: { threshold: 0.70, minLenBp: 4000, label: "高精度", desc: "只保留高置信、长片段 (thr=0.70, min=4 kb)" },
};

export function SubmitForm({ isLoggedIn }: { isLoggedIn: boolean }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preset, setPreset] = useState<Preset>("balanced");
  const [threshold, setThreshold] = useState(0.5);
  const [minLenBp, setMinLenBp] = useState(2000);
  const [advanced, setAdvanced] = useState(false);
  const [token, setToken] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sniffOk, setSniffOk] = useState<boolean | null>(null);
  const [sniffMsg, setSniffMsg] = useState<string>("");

  const cap = isLoggedIn ? AUTH_MAX : ANON_MAX;
  const turnstileEnabled = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    const p = PRESETS[preset];
    setThreshold(p.threshold);
    setMinLenBp(p.minLenBp);
  }, [preset]);

  async function pickFile(f: File | null) {
    setFile(f);
    setSniffOk(null);
    setSniffMsg("");
    if (!f) return;
    if (f.size > cap) {
      setSniffOk(false);
      setSniffMsg(`文件 ${(f.size / 1024 / 1024).toFixed(1)} MB，超过${isLoggedIn ? "" : "匿名"}上限 ${(cap / 1024 / 1024).toFixed(0)} MB${isLoggedIn ? "" : "（登录可放宽到 50 MB）"}。`);
      return;
    }
    const result = await sniffFasta(f);
    if (!result.ok) {
      setSniffOk(false);
      setSniffMsg(result.reason);
    } else {
      setSniffOk(true);
      setSniffMsg(`${(f.size / 1024 / 1024).toFixed(2)} MB · 看起来是有效的 FASTA。`);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) { setError("请先选择 FASTA 文件"); return; }
    if (sniffOk === false) { setError(sniffMsg || "文件格式校验未通过"); return; }
    if (turnstileEnabled && !token) { setError("请先完成人机校验"); return; }

    setPhase("hashing");
    const sha = await sha256OfBlob(file);

    setPhase("creating");
    const r1 = await fetch("/api/jobs/new", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        sha256: sha,
        bytes: file.size,
        threshold,
        minLenBp,
        clientId: isLoggedIn ? undefined : getOrCreateClientId(),
        turnstileToken: token || undefined,
      }),
    });
    if (!r1.ok) {
      const j = await r1.json().catch(() => ({}));
      setPhase("error");
      setError(j.error ?? `创建任务失败 (${r1.status})`);
      return;
    }
    const { jobId, uploadUrl } = await r1.json() as { jobId: string; uploadUrl: string };

    setPhase("uploading");
    setProgress(0);
    await uploadWithProgress(uploadUrl, file, setProgress);

    setPhase("done");
    router.push(`/jobs/${jobId}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0] ?? null;
          if (f) void pickFile(f);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`relative cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          dragOver
            ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
            : "border-slate-300 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-600"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".fasta,.fna,.fa,.txt,text/plain"
          onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
          className="sr-only"
        />
        <DnaIcon className="mx-auto h-10 w-10 text-slate-400" />
        <div className="mt-3 text-sm font-medium">
          {file ? file.name : "拖放 FASTA 文件至此，或点击选择"}
        </div>
        <div className="mt-1 text-xs text-slate-500">
          支持 .fasta / .fna / .fa · 上限 {(cap / 1024 / 1024).toFixed(0)} MB
          {!isLoggedIn && (
            <>（<span className="text-slate-700 dark:text-slate-300">登录可放宽到 50 MB</span>）</>
          )}
        </div>
        {sniffOk !== null && (
          <div className={`mt-3 inline-flex rounded-md px-3 py-1 text-xs ${
            sniffOk
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
          }`}>
            {sniffMsg}
          </div>
        )}
      </div>

      {/* Presets */}
      <div className="space-y-3">
        <div className="text-sm font-medium">检测预设</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(PRESETS) as Preset[]).map((k) => {
            const p = PRESETS[k];
            const active = preset === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setPreset(k)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  active
                    ? "border-indigo-500 bg-indigo-50/60 dark:border-indigo-400 dark:bg-indigo-950/30"
                    : "border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700"
                }`}
              >
                <div className="text-sm font-semibold">{p.label}</div>
                <div className="mt-1 text-xs text-slate-500">{p.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Advanced */}
      <details
        open={advanced}
        onToggle={(e) => setAdvanced((e.target as HTMLDetailsElement).open)}
        className="rounded-md border border-slate-200 dark:border-slate-800"
      >
        <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300">
          高级参数 (覆盖预设)
        </summary>
        <div className="grid gap-4 border-t border-slate-200 p-4 sm:grid-cols-2 dark:border-slate-800">
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">阈值 (sigmoid)</span>
            <input
              type="number" min={0.05} max={0.95} step={0.05}
              value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">最小区域长度 (bp)</span>
            <input
              type="number" min={100} max={1_000_000} step={100}
              value={minLenBp} onChange={(e) => setMinLenBp(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </label>
        </div>
      </details>

      {turnstileEnabled && <TurnstileWidget onToken={setToken} />}
      {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>}

      {/* Submit */}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={phase !== "idle" && phase !== "error"}
          className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-600"
        >
          {phase === "idle" || phase === "error" ? "开始分析" :
           phase === "hashing" ? "校验文件…" :
           phase === "creating" ? "创建任务…" :
           phase === "uploading" ? `上传中 ${progress}%` :
           "完成"}
        </button>
        {phase === "uploading" && (
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div className="h-full bg-indigo-600 transition-[width] duration-100" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
    </form>
  );
}

function DnaIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M5 4c0 4 14 4 14 8s-14 4-14 8" />
      <path d="M5 20c0-4 14-4 14-8S5 8 5 4" />
      <path d="M7 7h10M7 17h10M5.5 10h13M5.5 14h13" strokeOpacity="0.6" />
    </svg>
  );
}

async function uploadWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`upload failed: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("network error during upload"));
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "text/plain");
    xhr.send(file);
  });
}
