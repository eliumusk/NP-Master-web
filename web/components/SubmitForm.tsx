"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sha256OfBlob, sniffFasta } from "@/lib/fasta";
import { TurnstileWidget } from "./TurnstileWidget";

const MAX_BYTES = 10 * 1024 * 1024;

type Phase = "idle" | "hashing" | "creating" | "uploading" | "done" | "error";

export function SubmitForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [threshold, setThreshold] = useState(0.5);
  const [minLenBp, setMinLenBp] = useState(2000);
  const [token, setToken] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) return setError("Pick a FASTA file.");
    if (file.size > MAX_BYTES) return setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB > 10 MB).`);
    if (!token) return setError("Complete the Turnstile challenge.");

    const sniff = await sniffFasta(file);
    if (!sniff.ok) return setError(sniff.reason);

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
        turnstileToken: token,
      }),
    });
    if (!r1.ok) {
      const j = await r1.json().catch(() => ({}));
      setPhase("error");
      return setError(j.error ?? `create failed (${r1.status})`);
    }
    const { jobId, uploadUrl } = (await r1.json()) as { jobId: string; uploadUrl: string };

    setPhase("uploading");
    const r2 = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: file,
    });
    if (!r2.ok) {
      setPhase("error");
      return setError(`upload failed (${r2.status})`);
    }

    setPhase("done");
    router.push(`/jobs/${jobId}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <label className="block">
        <span className="text-sm font-medium">FASTA file (.fasta / .fna / .fa, ≤ 10 MB)</span>
        <input
          type="file"
          accept=".fasta,.fna,.fa,.txt,text/plain"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm"
          required
        />
        {file && (
          <p className="mt-1 text-xs text-slate-500">
            {file.name} — {(file.size / 1024).toFixed(1)} KB
          </p>
        )}
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">Threshold (sigmoid)</span>
          <input
            type="number"
            min={0.05}
            max={0.95}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
          />
          <p className="mt-1 text-xs text-slate-500">
            Lower = more recall, more false positives. Default 0.50.
          </p>
        </label>
        <label className="block">
          <span className="text-sm font-medium">Min region length (bp)</span>
          <input
            type="number"
            min={100}
            max={1_000_000}
            step={100}
            value={minLenBp}
            onChange={(e) => setMinLenBp(Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
          />
          <p className="mt-1 text-xs text-slate-500">
            Drop region calls shorter than this. Default 2 000 bp.
          </p>
        </label>
      </div>

      <TurnstileWidget onToken={setToken} />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={phase !== "idle" && phase !== "error"}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {phase === "idle" || phase === "error" ? "Submit" :
         phase === "hashing" ? "Hashing…" :
         phase === "creating" ? "Creating job…" :
         phase === "uploading" ? "Uploading…" : "Done"}
      </button>
    </form>
  );
}
