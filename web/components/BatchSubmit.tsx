"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getOrCreateClientId } from "@/lib/clientId";
import { sha256OfBlob, sniffFasta } from "@/lib/fasta";

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
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Picked[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [title, setTitle] = useState("BGCMaster 批量分析");
  const [threshold, setThreshold] = useState(0.95);
  const [extendThreshold, setExtendThreshold] = useState(0.8);
  const [safeTierMin, setSafeTierMin] = useState("Tier2");

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
        item.message = `文件大小 ${(file.size / 1024 / 1024).toFixed(1)} MB，限制为 ${(maxBytes / 1024 / 1024).toFixed(0)} MB。`;
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
      setError("请至少选择一个有效的 FASTA 文件。");
      return;
    }
    if (!isLoggedIn && validFiles.length > 1) {
      setError("匿名模式一次只能提交一个 FASTA。");
      return;
    }
    if (extendThreshold > threshold) {
      setError("扩展阈值必须小于或等于起始阈值。");
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
      if (!createRes.ok) throw new Error(created.error ?? `创建任务失败 (${createRes.status})`);

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
      if (!doneRes.ok) throw new Error(done.error ?? `加入队列失败 (${doneRes.status})`);
      router.push(`/jobs/${created.jobId}`);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="rounded-section border border-border bg-surface p-5">
      <div className="space-y-4">
        {!compact && (
          <label className="block">
            <span className="text-sm font-medium">任务标题</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-btn border border-border bg-bg px-3 py-2 text-sm"
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
          className="cursor-pointer rounded-card border-2 border-dashed border-border bg-elevated/30 p-6 text-center hover:border-brand"
        >
          <input
            ref={inputRef}
            type="file"
            multiple={isLoggedIn}
            accept=".fa,.fasta,.fna,.txt,text/plain"
            className="sr-only"
            onChange={(e) => e.target.files && void addFiles(e.target.files)}
          />
          <div className="text-sm font-medium">拖入 FASTA 文件，或点击选择</div>
          <div className="mt-1 text-xs text-fg-muted">
            {isLoggedIn ? `最多 ${AUTH_MAX_FILES} 个文件，每个 50 MB` : "匿名模式：1 个文件，10 MB"}
          </div>
        </div>

        {files.length > 0 && (
          <div className="space-y-2">
            {files.map((item, i) => (
              <div key={`${item.file.name}-${i}`} className="rounded-card border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <input
                      value={item.genomeName}
                      onChange={(e) => setFiles((xs) => xs.map((x, idx) => idx === i ? { ...x, genomeName: e.target.value } : x))}
                      className="w-full rounded-btn border border-border bg-bg px-2 py-1 font-mono text-xs"
                    />
                    <div className={`mt-1 text-xs ${item.ok === false ? "text-red-600" : "text-fg-muted"}`}>
                      {item.file.name} · {item.message ?? "等待检查"}
                    </div>
                  </div>
                  <button type="button" onClick={() => removeAt(i)} className="rounded-btn px-2 py-1 text-xs text-fg-muted hover:bg-elevated">
                    移除
                  </button>
                </div>
                {(item.progress ?? 0) > 0 && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-elevated">
                    <div className="h-full bg-brand" style={{ width: `${item.progress ?? 0}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField label="起始阈值" value={threshold} setValue={setThreshold} min={0.05} max={0.99} step={0.01} />
          <NumberField label="扩展阈值" value={extendThreshold} setValue={setExtendThreshold} min={0.05} max={0.99} step={0.01} />
          <label className="block">
            <span className="text-xs font-medium text-fg-muted">最低安全等级</span>
            <select
              value={safeTierMin}
              onChange={(e) => setSafeTierMin(e.target.value)}
              className="mt-1 w-full rounded-btn border border-border bg-bg px-3 py-2 text-sm"
            >
              {["Tier1", "Tier2", "Tier3", "Tier4", "Tier5"].map((tier) => <option key={tier}>{tier}</option>)}
            </select>
          </label>
        </div>

        {error && <div className="rounded-card border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="w-full rounded-btn bg-brand px-4 py-2.5 text-sm font-medium text-brand-fg disabled:opacity-50"
        >
          {phase === "idle" || phase === "error" ? "创建 BGCMaster 任务" :
           phase === "hashing" ? "正在计算文件指纹..." :
           phase === "creating" ? "正在创建任务..." :
           phase === "uploading" ? "正在上传 FASTA..." :
           "正在加入队列..."}
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
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setValue(Number(e.target.value))}
        className="mt-1 w-full rounded-btn border border-border bg-bg px-3 py-2 text-sm"
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
      else reject(new Error(`上传失败 (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("上传过程中网络异常"));
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", "text/plain");
    xhr.send(file);
  });
}
