// Client-side GFF3 sniffing for the optional annotation attachment.
// Accepts files with a `##gff-version` directive or headerless 9-column rows.

export type Gff3Sniff = { ok: boolean; reasonKey?: "empty" | "invalid" };

export async function sniffGff3(file: File): Promise<Gff3Sniff> {
  const head = await file.slice(0, 8192).text();
  const lines = head
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { ok: false, reasonKey: "empty" };
  if (lines.some((l) => l.startsWith("##gff-version"))) return { ok: true };
  const looksLikeGff = lines.some((l) => {
    if (l.startsWith("#")) return false;
    const cols = l.split("\t");
    return cols.length >= 8 && /^\d+$/.test(cols[3]) && /^\d+$/.test(cols[4]);
  });
  return looksLikeGff ? { ok: true } : { ok: false, reasonKey: "invalid" };
}
