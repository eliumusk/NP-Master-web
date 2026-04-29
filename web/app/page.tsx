import Link from "next/link";

export default function Page() {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Find BGC regions in any bacterial genome.</h1>
        <p className="max-w-2xl text-slate-600 dark:text-slate-400">
          Upload a FASTA. We extract per-token features with a frozen Evo2 7B and call BGC regions
          with a 1D U-Net trained on antiSMASH labels with a weak-negative BCE objective.
          Results come back as a region table, a downloadable CSV/BED, and an IGV-style browser.
        </p>
        <div className="flex gap-3">
          <Link href="/submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900">
            Submit a genome
          </Link>
          <Link href="/about" className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900">
            How it works
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="OER AS-recall" value="0.5703" hint="thr=0.50, min=2 kb" />
        <Stat label="Wet-lab PASS" value="171" hint="OER004256 first-pass" />
        <Stat label="Per-job latency" value="~60–120 s" hint="single A800, GPU shared with research" />
      </section>

      <section className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
        <strong>Discovery-grade only.</strong> The U-Net mainline is exploratory; its 9-genome
        thresholds were selected post-hoc. Use predictions as candidates for downstream HMM /
        antiSMASH triage, not as a final benchmark claim.
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border border-slate-200 p-4 dark:border-slate-800">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-slate-500">{hint}</div>
    </div>
  );
}
