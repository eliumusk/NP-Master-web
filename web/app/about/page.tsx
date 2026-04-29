export default function AboutPage() {
  return (
    <article className="prose prose-slate max-w-none dark:prose-invert">
      <h1>About this demo</h1>

      <h2>Pipeline</h2>
      <ol>
        <li>FASTA → sliding 8 192 bp windows (stride 2 048).</li>
        <li>Frozen Evo2 7B forward; pull <code>blocks.20.mlp.l3</code> activations.</li>
        <li>Project to 128 dims (fixed seed 0xE2E2), mean-pool every 8 tokens → ~1 token / 64 bp.</li>
        <li>1D U-Net (~150 K params) emits per-token sigmoid; threshold + merge → regions.</li>
      </ol>

      <h2>What you get</h2>
      <ul>
        <li><b>regions.csv</b>: <code>genome,contig,start,end,score,type</code></li>
        <li><b>regions.bed</b>: 5-column BED suitable for IGV / UCSC.</li>
        <li><b>IGV-style browser</b>: your FASTA + the predicted regions overlaid.</li>
      </ul>

      <h2>Limits</h2>
      <ul>
        <li>FASTA upload capped at 10 MB.</li>
        <li>Three concurrent jobs per user (queued or running).</li>
        <li>The Evo2 backbone shares a GPU with active research workloads. If the GPU is busy,
            your job will wait up to 30 minutes before failing with a "gpu busy timeout".</li>
        <li>Default thresholds: <code>0.50</code> sigmoid + min length <code>2 000 bp</code> —
            the OER discovery operating point.</li>
      </ul>

      <h2>Citations</h2>
      <p>
        Evo2: Nguyen, Brixi, Romero, Goodman, Mikulasov, et al. (2025). <em>Genome modeling and design across all
        domains of life with Evo 2.</em>{" "}
        AntiSMASH 7.0: Blin, K. et al. (2023).
      </p>

      <h2>Data retention</h2>
      <p>
        Uploaded FASTAs are deleted 7 days after submission; result CSV/BED files are deleted 30
        days after submission. Predicted region rows in the database are retained.
      </p>
    </article>
  );
}
