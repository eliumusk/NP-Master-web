// Browser-side FASTA helpers: sha256 of the file + sniff validation.

export async function sha256OfBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sniffFasta(file: File, maxBytes = 1 << 20): Promise<{ ok: true } | { ok: false; reason: string }> {
  const head = await file.slice(0, Math.min(file.size, maxBytes)).text();
  if (!head.trimStart().startsWith(">")) {
    return { ok: false, reason: "file does not start with a FASTA header line ('>')" };
  }
  const seq = head
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith(">"))
    .join("")
    .toUpperCase();
  if (seq.length === 0) return { ok: true };
  const allowed = new Set(["A", "C", "G", "T", "N"]);
  let ok = 0;
  for (const c of seq) if (allowed.has(c)) ok++;
  const ratio = ok / seq.length;
  if (ratio < 0.9) {
    return { ok: false, reason: `sequence content is only ${(ratio * 100).toFixed(1)}% ACGTN` };
  }
  return { ok: true };
}
